import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiceRoller } from './components/narrative/DiceRoller.js';
import './index.css';
// Development-only visual harness: fixed HTTP-like verdicts, no world mutation.
let mode = '1d100';
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => String(input) !== '/api/dice' ? originalFetch(input, init) : new Response(JSON.stringify({dice:mode,rolls:[mode === '1d10' ? 10 : 62],result:mode === '1d10' ? 10 : 62,passed:true,crit:mode === '1d10',fumble:false}),{headers:{'Content-Type':'application/json'}});
function Preview() {
 const [key,setKey]=useState(0);
 return <main style={{padding:40}} onPointerDown={event=>{ if (!(event.target as HTMLElement).closest('main')) event.currentTarget.setPointerCapture(event.pointerId); }}>
  <h1>D10 interaction check</h1><p>Visual test only: fixed scores 10 / 62, no world writes. The parent captures pointers to reproduce the canvas interaction.</p>
  <DiceRoller key={key} filePath="world/test.md" rollDice={{desc:mode === '1d10' ? 'A single D10' : 'Percentile dice',expect:mode === '1d10' ? '>=6' : '<=65'}} />
  <button onClick={()=>setKey(k=>k+1)}>Reset test</button> · <button onClick={()=>{mode='1d10';setKey(k=>k+1);}}>Use 1d10</button> · <button onClick={()=>{mode='1d100';setKey(k=>k+1);}}>Use 1d100</button>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
