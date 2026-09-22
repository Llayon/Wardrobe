import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`[wardrobe] listening on http://localhost:${config.port}`);
});

export default app;
