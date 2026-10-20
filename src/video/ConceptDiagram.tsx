import React from 'react';
import {interpolate,useCurrentFrame} from 'remotion';
import type {TimedScene} from '../contracts';
const ink='#153c3a',teal='#168779';
const reveal=(frame:number,start:number)=>interpolate(frame,[start,start+18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
export function wrapLabel(text:string,max=22):string[]{
 const lines:string[]=[];let line='';
 for(const word of text.split(/\s+/)){if(line&&(line+' '+word).length>max){lines.push(line);line=word;}else line=line?line+' '+word:word;}
 if(line)lines.push(line);return lines;
}
export function ConceptDiagram({scene}:{scene:TimedScene}){
 const f=useCurrentFrame();
 if(scene.type==='comparison'){
  const sides=scene.comparison?[scene.comparison.left,scene.comparison.right]:scene.labels.slice(0,2).map(heading=>({heading,points:[]}));
  return <>{sides.map((side,index)=>{
   const x=25+index*425,appear=reveal(f,8+index*8);
   return <g key={index} opacity={appear} transform={`translate(${x} ${(1-appear)*15})`}>
    <rect y="45" width="385" height="565" rx="32" fill={index?'#e8e5d9':'#dbe9e6'} stroke={index?'#d7d0ba':'#bfd4cf'} strokeWidth="2"/>
    <rect x="28" y="75" width="56" height="7" rx="3.5" fill={index?'#e9a64d':teal}/>
    <text x="28" y="145" fontSize="34" fontWeight="600" fill={ink}>{side.heading}</text>
    <line x1="28" y1="182" x2="355" y2="182" stroke="#bccfc8" strokeWidth="2"/>
    {side.points.map((point,j)=>{
     const show=reveal(f,scene.cueFrame+index*12+j*20),y=240+j*125;
     return <g key={j} opacity={show} transform={`translate(0 ${(1-show)*12})`}>
      <circle cx="39" cy={y-8} r="5" fill={teal}/>
      <text x="62" y={y} fill={ink} fontSize="27">{wrapLabel(point,20).map((line,k)=><tspan key={k} x="62" dy={k?35:0}>{line}</tspan>)}</text>
     </g>;
    })}
   </g>;
  })}<text x="430" y="665" textAnchor="middle" fill={teal} fontSize="23" letterSpacing="3">COMPARE AT A GLANCE</text></>;
 }
 return <>{scene.labels.map((label,index)=>{
  const y=40+index*158,show=reveal(f,scene.cueFrame+index*18);
  return <g key={index} opacity={show} transform={`translate(${(1-show)*-16} 0)`}>
   <rect x="95" y={y} width="670" height="110" rx="25" fill={index%2?'#e0e8df':'#dbe9e6'} stroke="#ced9d1" strokeWidth="2"/>
   <circle cx="155" cy={y+55} r="28" fill={teal}/>
   <text x="155" y={y+65} textAnchor="middle" fill="white" fontSize="27">{index+1}</text>
   <text x="215" y={y+65} fill={ink} fontSize="32">{label}</text>
   {index<scene.labels.length-1&&<path d={`M430 ${y+118}v27m-8-8 8 8 8-8`} fill="none" stroke={teal} strokeWidth="3" strokeLinecap="round"/>}
  </g>;
 })}</>;
}
