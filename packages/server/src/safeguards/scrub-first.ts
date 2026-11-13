// Provides nothing but a side effect: importing this module scrubs the environment (§4.5). Every
// entry of the server lists it as its first import, and an ES module is evaluated after the modules
// it imports, in order, so the scrub runs before any other module of the server is evaluated.
import { scrubEnvironment } from "./scrub";

scrubEnvironment();
