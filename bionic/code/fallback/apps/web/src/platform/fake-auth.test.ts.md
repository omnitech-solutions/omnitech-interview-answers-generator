# apps/web/src/platform/fake-auth.test.ts

_Source: `apps/web/src/platform/fake-auth.test.ts` (header-comment fallback)_

Docker publishes the port on 127.0.0.1 only, but inside the container every
client arrives from the bridge gateway (172.x), which Next reports as
X-Forwarded-For; without an operator assertion the local sign-in was off for
the person sitting at this machine. The assertion ignores only the forwarded
client address: a non-loopback Host, or a public forwarded host from a real
reverse proxy, still turns the offer off.
