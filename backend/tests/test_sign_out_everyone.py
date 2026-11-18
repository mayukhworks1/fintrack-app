"""Admin → Sign out everyone (services/security_state.py, routers/auth.py)."""
import app.routers.auth as A
from app.services import security_state as SS


def test_generation_zero_signs_as_before(monkeypatch):
    monkeypatch.setattr(SS, "_epoch", 0)
    import hashlib, hmac
    from app.config import settings
    assert A._sign(b"x") == hmac.new(settings.app_secret.encode(), b"x", hashlib.sha256).digest()


def test_sign_out_everyone_invalidates_every_token_and_session(pg, monkeypatch):
    monkeypatch.setattr(SS, "_epoch", 0)
    old_role_token = A.make_token("editor")
    assert A.verify_token(old_role_token) == "editor"
    uid = pg.user("Someone")
    pg.sql("INSERT INTO auth_sessions (user_id, token_hint, expires_at) VALUES ($1, 'abcdabcdabcdabcd', NOW() + INTERVAL '1 day')", uid)

    async def main(pool):
        return await SS.sign_out_everyone("owner@test", pool)
    out = pg.run(main)
    assert out["generation"] == 1 and out["sessions_revoked"] >= 1
    assert A.verify_token(old_role_token) is None             # old tokens stop working
    assert A.verify_token(A.make_token("editor")) == "editor"  # new sign-ins work
    assert pg.sql("SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_at IS NULL")[0]["n"] == 0

    monkeypatch.setattr(SS, "_epoch", 0)

    async def reload(pool):
        return await SS.load_epoch(pool)
    assert pg.run(reload) == 1                                  # survives a restart
