"""A silent build stream keeps its connection alive with comment pings."""
import asyncio

from app.routers.pages import SSE_PING, with_heartbeat


def test_pings_fill_the_silence_and_frames_pass_through_in_order():
    async def slow():
        yield {"type": "status"}
        await asyncio.sleep(0.25)
        yield {"type": "done"}

    async def run():
        return [f async for f in with_heartbeat(slow(), every=0.05)]

    out = asyncio.run(run())
    assert out[0] == {"type": "status"} and out[-1] == {"type": "done"}
    assert out.count(None) >= 2
    assert SSE_PING.startswith(":") and SSE_PING.endswith("\n\n")


def test_closing_early_closes_the_source():
    closed = []

    async def source():
        try:
            while True:
                await asyncio.sleep(0.01)
                yield {"type": "delta"}
        finally:
            closed.append(True)

    async def run():
        gen = with_heartbeat(source(), every=1)
        assert (await gen.__anext__()) == {"type": "delta"}
        await gen.aclose()

    asyncio.run(run())
    assert closed == [True]
