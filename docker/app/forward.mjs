// A one-purpose TCP forwarder: 127.0.0.1:1234 inside a container -> LM Studio on
// the host. The assistant's LM Studio transport (a vendored package) refuses any
// URL that is not loopback, and from a container the host is not loopback; so the
// container gets its own loopback port that relays to the host. It binds loopback
// only and forwards to exactly one target, set by the compose file
// (LM_STUDIO_FORWARD=host:port); nothing else can reach it.
import net from "node:net";

const target = process.env.LM_STUDIO_FORWARD ?? "";
const separator = target.lastIndexOf(":");
const host = target.slice(0, separator);
const port = Number(target.slice(separator + 1));
if (separator < 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("forward: LM_STUDIO_FORWARD must be host:port");
  process.exit(1);
}

net
  .createServer((client) => {
    const upstream = net.connect(port, host);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.pipe(upstream);
    upstream.pipe(client);
  })
  .listen(1234, "127.0.0.1", () =>
    console.log(`forward: 127.0.0.1:1234 -> ${host}:${port}`),
  );
