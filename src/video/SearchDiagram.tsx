import React from 'react';
import {interpolate,useCurrentFrame} from 'remotion';
import {binaryTrace} from '../pipeline/search';
import type {TimedScene} from '../contracts';
const ink='#153c3a',teal='#168779',orange='#e9a64d';
export function SearchDiagram({scene}:{scene:TimedScene}){
 const f=useCurrentFrame(),s=scene.search!;
 const trace=binaryTrace(s.values,s.target),step=trace[s.step];
 const setup=s.mode==='setup',result=s.mode==='result';
 const checked=!setup&&f>=scene.cueFrame;
 const decided=!setup&&(result?checked:f>=(scene.decisionFrame??Infinity));
 const found=decided&&step.outcome==='found';
 const absent=decided&&step.nextLow>step.nextHigh;
 const progress=decided?interpolate(f,[result?scene.cueFrame:scene.decisionFrame!, (result?scene.cueFrame:scene.decisionFrame!)+18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'}):0;
 const cell=Math.min(86,720/s.values.length-10),gap=10,total=s.values.length*(cell+gap)-gap,left=(860-total)/2;
 const low=setup?0:decided?step.nextLow:step.low,high=setup?s.values.length-1:decided?step.nextHigh:step.high;
 const note=setup?'Start with a sorted list':found?'Match found':absent?'No candidates remain':decided?(step.outcome==='right'?'Keep the larger values':'Keep the smaller values'):checked?`${s.values[step.mid]} ${step.outcome==='right'?'<':step.outcome==='left'?'>':'='} ${s.target}`:'Check the middle value';
 return <>
  <rect x="290" y="35" width="280" height="100" rx="24" fill="#dbe9e6"/>
  <text x="430" y="73" textAnchor="middle" fontSize="19" letterSpacing="3" fill={teal}>FIND THIS VALUE</text>
  <text x="430" y="115" textAnchor="middle" fontSize="38" fontWeight="600" fill={ink}>{s.target}</text>
  <text x="430" y="193" textAnchor="middle" fontSize="22" fill="#6c827b">{setup?'SORTED · LOW TO HIGH':`COMPARISON ${s.step+1}`}</text>
  {s.values.map((value,i)=>{
   const previous=setup||i>=step.low&&i<=step.high;
   const retained=i>=low&&i<=high;
   const opacity=!previous?0.18:decided&&!retained?1-.82*progress:1;
   const midpoint=checked&&i===step.mid;
   const matched=found&&i===step.mid;
   const x=left+i*(cell+gap);
   return <g key={i} opacity={opacity}>
    <rect x={x} y="245" width={cell} height="100" rx="18" fill={matched?teal:midpoint?'#f5dfbb':'#e0e8df'} stroke={matched?teal:midpoint?orange:'#c3d5ce'} strokeWidth={midpoint?4:2}/>
    <text x={x+cell/2} y="310" textAnchor="middle" fill={matched?'white':ink} fontSize="36" fontWeight="600">{value}</text>
    {!retained&&decided&&<path d={`M${x+12} 266l${cell-24} 60`} stroke={ink} strokeWidth="2" opacity={progress*.5}/>}
   </g>;
  })}
  {checked&&<g transform={`translate(${left+step.mid*(cell+gap)+cell/2} 366)`}>
   <path d="M0 26V0m-7 7 7-7 7 7" fill="none" stroke={found?teal:orange} strokeWidth="4" strokeLinecap="round"/>
   <text x="0" y="59" textAnchor="middle" fontSize="20" fill={ink}>{found?'FOUND':'MIDPOINT'}</text>
  </g>}
  <rect x="70" y="465" width="720" height="115" rx="26" fill={found?'#cfe4db':'#ffffff80'} stroke="#d0dcd4" strokeWidth="2"/>
  <text x="430" y="512" textAnchor="middle" fontSize="30" fontWeight="600" fill={ink}>{note}</text>
  <text x="430" y="551" textAnchor="middle" fontSize="22" fill={teal}>{found?'Stop searching':absent?'The target is not in this list':`${Math.max(0,high-low+1)} candidate${high-low===0?'':'s'} remaining`}</text>
  <g transform="translate(275 635)"><rect width="16" height="16" rx="4" fill={teal}/><text x="28" y="15" fontSize="20" fill={ink}>Candidates</text><rect x="180" width="16" height="16" rx="4" fill="#d9ddd5"/><text x="208" y="15" fontSize="20" fill="#6c827b">Eliminated</text></g>
 </>;
}
