// Usage example: npm i react react-dom gsap, then render <App /> anywhere.
import gsap from "gsap";
import { VisualSelectionLayerGsap, VisualSelectionLayerScope } from "./VisualSelectionLayerGsap.js";

export default function App() {
  return (
    <main>
      <VisualSelectionLayerGsap gsap={gsap} effect="pop" vars={{ color: "#d4f53c", radius: "9px", "pad-x": "5px", "pad-y": "3px" }} />
      <h1>Select anything</h1>
      <p>Overlapping lines merge into one rounded layer.</p>
      <VisualSelectionLayerScope as="aside" vars={{ color: "#ffd7a6" }}>
        <p>Selections that stay inside this aside are warm.</p>
      </VisualSelectionLayerScope>
      <VisualSelectionLayerScope ignore>
        <p>Native selection here.</p>
      </VisualSelectionLayerScope>
    </main>
  );
}
