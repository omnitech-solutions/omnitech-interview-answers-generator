// A test run's one choice about the AI engine's log: an engine, a job worker
// or a job service a test builds with no `log` says nothing. (The engine logs
// by default since its ADR-0036; the Studio's own engines are given the
// Studio's logger by `engineLog`, which is silent under NODE_ENV=test.) A test
// that reads the engine's lines gives its own sink, which this does not touch.
// It lives in this package because the engine resolves from here and not from
// the repository root.
import { setDefaultEngineLog } from "@omnitech/ai-engine";

setDefaultEngineLog({ level: "silent" });
