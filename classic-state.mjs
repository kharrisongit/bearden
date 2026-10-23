export const classicKeys=new Set(['app-state','notes','runnerHighScore','crushHighScore','questBestWave','catchSave','theme','holiday','linked-bills']);
export function validateClassic(state){
 if(!state||state.version!==1||!state.values||typeof state.values!=='object'||Array.isArray(state.values))throw Error('Invalid tracker backup');
 for(const [key,value] of Object.entries(state.values)){if(!classicKeys.has(key)||typeof value!=='string'||value.length>200000)throw Error('Invalid tracker data');if(['app-state','notes','catchSave','linked-bills'].includes(key))JSON.parse(value);}
 if(JSON.stringify(state).length>230000)throw Error('Tracker storage is full. Export a backup before removing old records.');
 return state;
}
