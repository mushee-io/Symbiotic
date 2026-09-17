import { runMmCycle } from "../src/live-mm.js";

const result = await runMmCycle();
console.log(JSON.stringify(result, null, 2));
