"""
Editing a web resource must not drop its links to other projects.

A resource can serve several projects (POST /api/web-resources/{id}/assign is
"multi-project safe"), and the edit drawer sends the project it was opened
from as project_id on every save. update_resource used to turn that into
Project = [project_id], unlinking every other project — and moving their
Teable rollups — whenever a rate was changed.
"""

import asyncio

import pytest

import app.services.web_project as WP
from app.routers.web_projects import ResourceFields


class _Resp:
    is_success = True
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class FakeTeable:
    """The resource record as Teable holds it, plus every request made."""

    def __init__(self, linked):
        self.record = {"id": "recR", "fields": {"Resource Name": "Dev",
                                                "Project": [{"id": p, "title": p} for p in linked]}}
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        self.calls.append(("GET", None))
        return _Resp(self.record)

    async def patch(self, url, json=None, **kw):
        fields = json["record"]["fields"]
        self.calls.append(("PATCH", fields))
        self.record["fields"].update(fields)
        return _Resp(self.record)

    async def post(self, url, json=None, **kw):
        fields = json["records"][0]["fields"]
        self.calls.append(("POST", fields))
        return _Resp({"records": [{"id": "recNew", "fields": fields}]})

    def linked(self):
        return [p["id"] for p in self.record["fields"]["Project"]]


@pytest.fixture
def teable(monkeypatch):
    holder = {}

    def make(linked):
        holder["t"] = FakeTeable(linked)
        monkeypatch.setattr(WP, "shared_client", lambda **k: holder["t"])
        return holder["t"]
    return make


def _update(fields):
    return asyncio.run(WP.WebResourceService().update_resource("recR", fields))


class TestUpdateKeepsLinks:
    def test_editing_from_one_project_keeps_the_others(self, teable):
        t = teable(["recA", "recB"])
        _update(ResourceFields(rate=1500, project_id="recA").to_teable_fields())

        assert t.linked() == ["recA", "recB"]
        patched = [f for verb, f in t.calls if verb == "PATCH"]
        assert patched == [{"Rate (₹)": 1500}]

    def test_a_new_project_id_is_added_not_swapped_in(self, teable):
        t = teable(["recA", "recB"])
        _update(ResourceFields(project_id="recC").to_teable_fields())
        assert t.linked() == ["recA", "recB", "recC"]

    def test_an_explicit_full_list_replaces_the_links(self, teable):
        t = teable(["recA", "recB"])
        _update(ResourceFields(project_ids=["recC", "recC", "recA"]).to_teable_fields())
        assert t.linked() == ["recC", "recA"]
        assert ("GET", None) not in t.calls   # nothing to merge with

    def test_an_explicit_empty_list_unlinks_everything(self, teable):
        t = teable(["recA"])
        _update({"project_ids": []})
        assert t.linked() == []

    def test_already_linked_and_nothing_else_is_a_no_op(self, teable):
        t = teable(["recA", "recB"])
        out = _update({"project_id": "recA"})
        assert [verb for verb, _ in t.calls] == ["GET"]
        assert out["id"] == "recR"

    def test_fields_without_project_id_do_not_touch_links(self, teable):
        t = teable(["recA", "recB"])
        _update(ResourceFields(notes="hi").to_teable_fields())
        assert [verb for verb, _ in t.calls] == ["PATCH"]
        assert t.linked() == ["recA", "recB"]


class TestCreate:
    def test_project_ids_link_every_listed_project(self, teable):
        t = teable([])
        asyncio.run(WP.WebResourceService().create_resource(
            ResourceFields(resource_name="Dev", project_ids=["recA", "recB"]).to_teable_fields()))
        [(verb, fields)] = t.calls
        assert fields["Project"] == [{"id": "recA"}, {"id": "recB"}]

    def test_single_project_id_still_works(self, teable):
        t = teable([])
        asyncio.run(WP.WebResourceService().create_resource(
            ResourceFields(resource_name="Dev", project_id="recA").to_teable_fields()))
        [(verb, fields)] = t.calls
        assert fields["Project"] == [{"id": "recA"}]
