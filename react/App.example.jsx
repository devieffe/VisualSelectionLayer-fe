// © 2026 Dev Ieffe. All rights reserved.
// Usage example: npm i react react-dom gsap, then render <App /> anywhere.
import gsap from "gsap";
import { Setexty, SetextyScope } from "./index.js";

export default function App() {
  return (
    <main>
      <Setexty gsap={gsap} effect="pop" vars={{ color: "#d4f53c", radius: "9px", "pad-x": "5px", "pad-y": "3px" }} />
      <h1>Select anything</h1>
      <p>Overlapping lines merge into one rounded layer.</p>
      <SetextyScope as="aside" vars={{ color: "#ffd7a6" }}>
        <p>Selections that stay inside this aside are warm.</p>
      </SetextyScope>
      <SetextyScope ignore>
        <p>Native selection here.</p>
      </SetextyScope>
    </main>
  );
}
