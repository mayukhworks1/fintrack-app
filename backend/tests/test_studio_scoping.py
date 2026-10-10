"""
Studio answers a user only from what that user can see.

The document list was owner-scoped for non-privileged roles, but /ask was not:
retrieval searched every user's ready chunks, so a scoped user's question came
back with excerpts and titles from other people's private documents, and
naming another user's document id worked too. The thread id was not checked
either — another user's conversation was read into the prompt and the new
turn written into their history.

The fake database below holds two users' documents and threads and applies
the owner and document-id predicates the queries actually carry. A query
without the owner predicate therefore sees everything, as Postgres would.
"""

import asyncio
import re
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import studio
from app.services import studio_ask

ALICE, BOB = "alice@example.com", "Bob@Example.com"
A_DOC, B_DOC = str(uuid.uuid4()), str(uuid.uuid4())
A_THREAD, B_THREAD = str(uuid.uuid4()), str(uuid.uuid4())

_OWNER = re.compile(r"LOWER\(d\.owner_email\) = LOWER\(\$(\d+)\)")
_IDS = re.compile(r"c\.document_id = ANY\(\$(\d+)::uuid\[\]\)")


class FakeDB:
    def __init__(self, full_text=True):
        self.full_text = full_text
        self.fail_threads = False
        self.docs = {
            A_DOC: {"owner_email": ALICE, "status": "ready", "title": "Alice - Britannia MSA", "filename": "a.pdf"},
            B_DOC: {"owner_email": BOB, "status": "ready", "title": "Bob - vendor notes", "filename": "b.pdf"},
        }
        self.chunks = [
            {"id": 1, "document_id": A_DOC, "page_number": 3,
             "content": "Payment terms with Britannia are net 30 days from invoice."},
            {"id": 2, "document_id": B_DOC, "page_number": 1,
             "content": "Payment terms for the vendor are net 45 days."},
        ]
        self.threads = {A_THREAD: ALICE, B_THREAD: BOB}
        self.turns = [
            {"thread_id": A_THREAD, "question": "What does Alice owe Britannia?", "answer": "INR 9,00,000 [1]"},
            {"thread_id": B_THREAD, "question": "Who is the vendor?", "answer": "Acme [1]"},
        ]

    # -- retrieval ----------------------------------------------------------
    def _visible(self, sql, args):
        m = _OWNER.search(sql)
        owner = args[int(m.group(1)) - 1] if m else None
        m = _IDS.search(sql)
        ids = args[int(m.group(1)) - 1] if m else None
        for c in self.chunks:
            d = self.docs[c["document_id"]]
            if d["status"] != "ready":
                continue
            if ids is not None and c["document_id"] not in ids:
                continue
            if owner is not None and d["owner_email"].lower() != owner.lower():
                continue
            yield c, d

    def _row(self, c, d, **extra):
        return {**c, "embedding_vec": None, "title": d["title"], "filename": d["filename"], **extra}

    async def fetch(self, sql, *args):
        if "to_tsquery" in sql:
            if not self.full_text:
                raise RuntimeError('column "content_tsv" does not exist')
            terms = args[0].split(" | ")
            return [self._row(c, d, rank=1.0, headline=c["content"])
                    for c, d in self._visible(sql, args)
                    if any(t in c["content"].lower() for t in terms)]
        if "c.content ~* $1" in sql:
            return [self._row(c, d) for c, d in self._visible(sql, args)
                    if re.search(args[0], c["content"], re.I)]
        if "FROM studio_turns" in sql:
            rows = [t for t in self.turns if t["thread_id"] == args[0]]
            return [{"question": t["question"], "answer": t["answer"]} for t in reversed(rows)][:3]
        raise AssertionError(f"unexpected query: {sql}")

    # -- threads ------------------------------------------------------------
    async def fetchval(self, sql, *args):
        assert "FROM studio_threads" in sql
        if self.fail_threads:
            raise ConnectionError("connection was closed in the middle of operation")
        thread_id, scope, *rest = args          # rest: the caller's login email
        login = rest[0] if rest else None
        uuid.UUID(thread_id)                     # asyncpg rejects a malformed uuid
        owner = self.threads.get(thread_id)
        if owner is None:
            return None
        if scope is not None and owner.lower() not in {scope.lower(), (login or "").lower()}:
            return None
        return 1

    async def fetchrow(self, sql, *args):
        assert sql.strip().startswith("INSERT INTO studio_threads")
        new = str(uuid.uuid4())
        self.threads[new] = args[2]
        return {"id": new}

    async def execute(self, sql, *args):
        if "INSERT INTO studio_turns" in sql:
            self.turns.append({"thread_id": args[0], "question": args[1], "answer": args[2]})


@pytest.fixture
def env(monkeypatch):
    db = FakeDB()
    model_calls = []

    async def fake_chat(messages, **kw):
        model_calls.append(messages)
        return {"content": "Net terms apply [1].", "model": "m", "model_short": "m"}

    async def fake_judge(question, answer, context):
        return {"verdict": "pass"}

    async def no_pgvector():
        return False

    async def allowed(user_id, role=None):
        return {"allowed": True, "used": 0, "limit": 200, "metered": True}

    monkeypatch.setattr(studio_ask, "get_pool", lambda: db)
    monkeypatch.setattr(studio, "get_pool", lambda: db)
    monkeypatch.setattr(studio_ask, "_try_chat", fake_chat)
    monkeypatch.setattr(studio_ask, "judge_answer", fake_judge)
    monkeypatch.setattr(studio_ask.embeddings, "is_pgvector_available", no_pgvector)
    monkeypatch.setattr(studio.ai_usage, "quota_state", allowed)
    return SimpleNamespace(db=db, model_calls=model_calls)


def _req(email, role="user"):
    return SimpleNamespace(state=SimpleNamespace(
        is_email_auth=True, auth_role=role, auth_user_id=str(uuid.uuid4()),
        auth_user_email=email, auth_teable_email=email,
    ))


def _ask(request, question="What are the payment terms?", document_ids=None, thread_id=None):
    body = studio.AskBody(question=question, document_ids=document_ids, thread_id=thread_id)
    return asyncio.run(studio.ask(body, request, role="viewer", _perm="viewer"))


def _prompt_text(messages):
    return "\n".join(m["content"] for m in messages)


class TestRetrievalScope:
    @pytest.mark.parametrize("full_text", [True, False], ids=["full-text", "keyword-fallback"])
    def test_a_scoped_user_is_answered_only_from_their_own_documents(self, env, full_text):
        env.db.full_text = full_text
        out = _ask(_req("bob@example.com"))          # case differs from the stored owner
        assert {s["document_id"] for s in out["sources"]} == {B_DOC}
        prompt = _prompt_text(env.model_calls[0])
        assert "Britannia" not in prompt and "net 45" in prompt

    def test_naming_someone_elses_document_finds_nothing(self, env):
        out = _ask(_req(BOB), document_ids=[A_DOC])
        assert out["sources"] == [] and out["verdict"] == "no-sources"
        assert env.model_calls == []

    def test_privileged_roles_still_search_the_whole_corpus(self, env):
        out = _ask(_req("ops@example.com", role="admin"))
        assert {s["document_id"] for s in out["sources"]} == {A_DOC, B_DOC}

    def test_the_service_scopes_without_the_router_too(self, env):
        chunks = asyncio.run(studio_ask.retrieve("payment terms", None, owner_email=ALICE))
        assert {str(c["document_id"]) for c in chunks} == {A_DOC}


class TestThreadOwnership:
    def test_someone_elses_thread_is_refused_before_the_model_runs(self, env):
        before = len(env.db.turns)
        with pytest.raises(HTTPException) as e:
            _ask(_req(BOB), thread_id=A_THREAD)
        assert e.value.status_code == 404
        assert env.model_calls == []
        assert len(env.db.turns) == before          # nothing written into Alice's history

    def test_your_own_thread_feeds_the_prompt_and_receives_the_turn(self, env):
        out = _ask(_req(BOB), thread_id=B_THREAD)
        assert out["thread_id"] == B_THREAD
        assert "Who is the vendor?" in _prompt_text(env.model_calls[0])
        assert env.db.turns[-1]["thread_id"] == B_THREAD

    def test_a_malformed_thread_id_is_not_found(self, env):
        with pytest.raises(HTTPException) as e:
            _ask(_req(BOB), thread_id="not-a-uuid")
        assert e.value.status_code == 404 and env.model_calls == []

    def test_privileged_roles_keep_reaching_every_thread(self, env):
        out = _ask(_req("ops@example.com", role="admin"), thread_id=A_THREAD)
        assert out["thread_id"] == A_THREAD

    @staticmethod
    def _overridden():
        """A scoped user whose admin-set teable_email differs from the login:
        the scope uses the override, new threads are stamped with the login."""
        req = _req("carol@example.com")
        req.state.auth_teable_email = "carol.raisedby@example.com"
        return req

    def test_a_teable_email_override_still_continues_its_own_conversation(self, env):
        first = _ask(self._overridden())
        follow = _ask(self._overridden(), question="And the vendor terms?", thread_id=first["thread_id"])
        assert follow["thread_id"] == first["thread_id"]
        assert [t["question"] for t in env.db.turns if t["thread_id"] == first["thread_id"]] == [
            "What are the payment terms?", "And the vendor terms?",
        ]

    def test_the_override_does_not_open_someone_elses_thread(self, env):
        with pytest.raises(HTTPException) as e:
            _ask(self._overridden(), thread_id=B_THREAD)
        assert e.value.status_code == 404

    def test_a_failed_ownership_read_is_not_reported_as_not_found(self, env):
        """The client forgets a conversation that answers 404; a database
        blip must not make it do that."""
        env.db.fail_threads = True
        with pytest.raises(HTTPException) as e:
            _ask(_req(BOB), thread_id=B_THREAD)
        assert e.value.status_code == 503 and env.model_calls == []

    def test_analyze_refuses_someone_elses_thread_before_the_model_runs(self, env, monkeypatch):
        analysed = []

        async def fake_analyze(question, owner_email):
            analysed.append(question)
            return {"answer": "x", "spec": {"dataset": "invoices"}}

        monkeypatch.setattr(studio.studio_analyst, "analyze", fake_analyze)
        body = studio.AnalyzeBody(question="Total billed this month?", thread_id=A_THREAD)
        with pytest.raises(HTTPException) as e:
            asyncio.run(studio.analyze(body, _req(BOB), role="viewer", _perm="viewer"))
        assert e.value.status_code == 404 and analysed == []
