export type SearchStep={low:number;high:number;mid:number;outcome:'left'|'right'|'found';nextLow:number;nextHigh:number};
/** Sorted, unique, small arrays keep this teaching diagram readable and unambiguous. */
export function binaryTrace(values:number[],target:number):SearchStep[]{
 if(values.length<3||values.length>9||values.some((v,i)=>!Number.isInteger(v)||v<0||v>99||(i>0&&v<=values[i-1])))throw new Error('Search values must be 3–9 distinct ascending integers from 0 to 99');
 if(!Number.isInteger(target)||target<0||target>99)throw new Error('Search target must be an integer from 0 to 99');
 let low=0,high=values.length-1;const steps:SearchStep[]=[];
 while(low<=high){const mid=Math.floor((low+high)/2);const outcome=values[mid]===target?'found':values[mid]<target?'right':'left';
 const nextLow=outcome==='right'?mid+1:low,nextHigh=outcome==='left'?mid-1:high;
 steps.push({low,high,mid,outcome,nextLow,nextHigh});if(outcome==='found')break;low=nextLow;high=nextHigh;}
 return steps;
}
