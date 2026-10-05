import { prebuildWeb } from "./stack";

// `pnpm test:browser` runs this once before it starts the shards.
prebuildWeb();
