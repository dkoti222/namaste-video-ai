import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Explainer} from './Explainer';
import fixture from '../../fixtures/water-cycle.json';
import {validatePlan} from '../contracts';
import {compile,syntheticSpeech} from '../pipeline/timing';
const plan=validatePlan(fixture);
const timeline=compile(plan,Object.fromEntries(plan.scenes.map(s=>[s.id,syntheticSpeech(s.narration)])),true);
registerRoot(()=> <Composition id="Explainer" component={Explainer} width={1080} height={1920} fps={30} durationInFrames={timeline.frames} defaultProps={{timeline}} calculateMetadata={({props})=>({durationInFrames:props.timeline.frames})}/>);
