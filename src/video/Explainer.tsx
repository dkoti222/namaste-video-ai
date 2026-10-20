import React from 'react';
import {AbsoluteFill,Audio,Sequence,staticFile,useCurrentFrame,interpolate} from 'remotion';
import type {Timeline,TimedScene} from '../contracts';
import {ConceptDiagram} from './ConceptDiagram';
import {SearchDiagram} from './SearchDiagram';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
const ink='#153c3a',teal='#168779',orange='#e9a64d',blue='#619ab4';
const fade=(f:number,start=0)=>interpolate(f,[start,start+18],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
function Cloud({x=0,y=0,scale=1}:{x?:number;y?:number;scale?:number}){return <g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M-92 26C-144 20-137-47-92-54C-87-116 8-135 37-74C95-91 137-25 100 16C89 31 66 32 42 32H-92Z" fill="#dbe8e6" stroke={ink} strokeWidth="4"/></g>}
function Sun({x=680,y=80}:{x?:number;y?:number}){const f=useCurrentFrame();return <g transform={`translate(${x} ${y})`}><g transform={`rotate(${f/10})`}>{Array.from({length:12},(_,i)=><line key={i} x1="0" y1="-65" x2="0" y2="-83" stroke={orange} strokeWidth="5" strokeLinecap="round" transform={`rotate(${i*30})`}/>)}</g><circle r="43" fill={orange}/></g>}
function Water({y=470}:{y?:number}){const f=useCurrentFrame();return <g><path d={`M30 ${y} Q130 ${y-25} 230 ${y}T430 ${y}T630 ${y}T830 ${y}V620H30Z`} fill="#b5d6df"/><path d={`M30 ${y+25} Q130 ${y+5} 230 ${y+25}T430 ${y+25}T630 ${y+25}T830 ${y+25}`} fill="none" stroke={blue} strokeWidth="3"/>{[0,1,2].map(i=><path key={i} d={`M${100+i*240+Math.sin(f/40)*10} ${y+75}h95`} stroke="#e9f2f1" strokeWidth="4" strokeLinecap="round"/>)}</g>}
function Diagram({scene}:{scene:TimedScene}){
 const f=useCurrentFrame(),after=Math.max(0,f-scene.cueFrame),active=fade(f,scene.cueFrame);
 const overview=scene.type==='overview';
 return <svg viewBox="0 0 860 700" style={{width:'100%',height:700,overflow:'visible'}}>
  <defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9" fill="none" stroke={teal} strokeWidth="1.5"/></marker></defs>
  {scene.type==='evaporation'&&<><Sun/><Water/>{Array.from({length:8},(_,i)=>{const t=((after+i*17)%110)/110;return <circle key={i} cx={110+i*88+Math.sin(t*6+i)*12} cy={455-t*290} r={7-t*3} fill={teal} opacity={active*(1-t)}/>})}<path d="M435 405V205" stroke={teal} strokeWidth="4" fill="none" markerEnd="url(#arrow)" opacity={active}/><text x="430" y="140" textAnchor="middle" fill={teal} fontSize="28" opacity={active}>INVISIBLE WATER VAPOUR</text></>}
  {scene.type==='condensation'&&<><Cloud x={430} y={260} scale={1.75}/>{Array.from({length:12},(_,i)=>{const angle=i*Math.PI/6;return <circle key={i} cx={430+Math.cos(angle)*(260-110*active)} cy={260+Math.sin(angle)*(160-75*active)} r={4+active*4} fill={blue} opacity={0.35+active*0.65}/>})}<path d="M430 490V375" stroke={teal} strokeWidth="4" markerEnd="url(#arrow)"/><text x="430" y="555" textAnchor="middle" fill={teal} fontSize="28">VAPOUR → LIQUID DROPLETS</text></>}
  {scene.type==='rain'&&<><Cloud x={430} y={200} scale={1.8}/><Water y={540}/>{Array.from({length:12},(_,i)=>{const t=((after+i*9)%65)/65;return <path key={i} d={`M${260+(i%6)*65} ${285+t*230}l-7 20`} stroke={blue} strokeWidth="6" strokeLinecap="round" opacity={active}/>})}</>}
  {scene.type==='collection'&&<><path d="M30 330L230 140L430 365L605 270L830 410V620H30Z" fill="#d7ded0"/><path d="M155 330C415 360 200 430 540 475L830 530" stroke="#8fbfce" strokeWidth="38" fill="none"/><path d="M180 335C410 365 230 430 635 489" stroke={teal} strokeWidth="4" strokeDasharray="14 16" strokeDashoffset={-after*2} fill="none" opacity={active}/><path d="M100 570h650" stroke={teal} strokeDasharray="4 14" strokeWidth="6" opacity={active}/><text x="430" y="660" textAnchor="middle" fill={teal} fontSize="25">ABOVE AND BELOW THE SURFACE</text></>}
  {overview&&<><Sun x={130} y={100}/><Cloud x={600} y={180} scale={1.15}/><Water y={505}/><path d="M100 415C95 260 240 180 375 165" fill="none" stroke={teal} strokeWidth="4" markerEnd="url(#arrow)"/><path d="M650 300V425" fill="none" stroke={teal} strokeWidth="4" markerEnd="url(#arrow)"/>{Array.from({length:6},(_,i)=><circle key={i} cx={130+i*30} cy={460-((f+i*22)%130)*1.25} r="5" fill={teal} opacity=".6"/>)}{[0,1,2,3].map(i=><path key={i} d={`M${540+i*50} ${310+((f+i*10)%60)*2}l-5 13`} stroke={blue} strokeWidth="4" strokeLinecap="round"/>)}<text x="435" y="390" textAnchor="middle" fill={ink} fontSize="92" fontWeight="600">H₂O</text></>}
  {scene.type==='binary-search'&&<SearchDiagram scene={scene}/>}
  {(scene.type==='flow'||scene.type==='comparison')&&<ConceptDiagram scene={scene}/>}
 </svg>;
}
function SceneView({scene,index,total,fixture}:{scene:TimedScene;index:number;total:number;fixture:boolean}){
 const f=useCurrentFrame(),caption=scene.captions.find(c=>f>=c.start&&f<c.end);
 return <AbsoluteFill style={{background:'#f5f3ec',color:ink,fontFamily:'DM Sans',padding:'125px 85px 100px'}}>
  {scene.audioFile&&<Audio src={staticFile(scene.audioFile)}/>}
  <div style={{display:'flex',justifyContent:'space-between',fontSize:23,letterSpacing:3,fontWeight:600,color:teal}}><span>{scene.kicker}</span><span>{String(index+1).padStart(2,'0')} / {String(total).padStart(2,'0')}</span></div>
  <div style={{marginTop:55,height:230,opacity:fade(f),transform:`translateY(${(1-fade(f))*20}px)`}}><h1 style={{fontSize:83,lineHeight:1.05,letterSpacing:-3.5,margin:0,fontWeight:600}}>{scene.title}</h1></div>
  <div style={{marginTop:5,opacity:fade(f,8)}}><Diagram scene={scene}/></div>
  <div style={{display:'flex',justifyContent:'center',gap:16,marginTop:34,flexWrap:'wrap'}}>{scene.labels.map((label,i)=><div key={i} style={{border:'1.5px solid #ced9d1',borderRadius:100,padding:'13px 23px',fontSize:25,background:'#ffffff60',opacity:fade(f,scene.cueFrame+i*6)}}>{label}</div>)}</div>
  <div style={{position:'absolute',bottom:225,left:90,right:90,height:170,display:'flex',alignItems:'center',justifyContent:'center'}}>{caption&&<div style={{background:ink,color:'#fff',borderRadius:22,padding:'23px 34px',fontSize:40,lineHeight:1.3,textAlign:'center',maxWidth:850}}>{caption.text}</div>}</div>
  <div style={{position:'absolute',bottom:105,left:90,right:90,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:20,color:'#6c827b'}}><span>{fixture?'SILENT FIXTURE · SYNTHETIC TIMING':'AI-GENERATED NARRATION'}</span><div style={{display:'flex',gap:8}}>{Array.from({length:total},(_,i)=><div key={i} style={{width:i===index?38:10,height:7,borderRadius:5,background:i<=index?teal:'#d4ded5'}}/>)}</div></div>
 </AbsoluteFill>;
}
export function Explainer({timeline}:{timeline:Timeline}){return <AbsoluteFill>{timeline.scenes.map((s,i)=><Sequence key={s.id} from={s.start} durationInFrames={s.frames}><SceneView scene={s} index={i} total={timeline.scenes.length} fixture={timeline.fixture}/></Sequence>)}</AbsoluteFill>}
