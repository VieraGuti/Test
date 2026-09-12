import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { generateMaze, mazeToWalls } from './maze.js';

const PORT = Number(process.env.PORT || 3000);
const MAZE_WIDTH = 12;
const MAZE_HEIGHT = 12;
const CELL_SIZE = 4;
const HIT_RADIUS = 0.8;
const MAX_HP = 100;
const DAMAGE = 25;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, '..', 'client', 'dist');
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};

const httpServer = createServer((req,res)=>{
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];
  const fullPath = join(DIST_DIR,filePath);
  if (existsSync(fullPath)) {
    const ext=extname(fullPath);res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache'});res.end(readFileSync(fullPath));
  } else {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(DIST_DIR,'index.html')));
  }
});
const wss = new WebSocketServer({server:httpServer});
let waitingPlayer=null;const games=new Map();let nextGameId=1;

wss.on('connection',(ws)=>{
  ws.playerData={x:0,y:1.7,z:0,rotY:0,rotX:0,hp:MAX_HP,gameId:null,playerId:null};
  ws.on('message',(data)=>{let msg;try{msg=JSON.parse(data);}catch{return;}switch(msg.type){case'join':handleJoin(ws);break;case'position':handlePosition(ws,msg);break;case'shoot':handleShoot(ws,msg);break;case'rematch':handleRematch(ws);break;}});
  ws.on('close',()=>handleDisconnect(ws));
});

function handleJoin(ws){
  if(waitingPlayer&&waitingPlayer.readyState===1){
    const gameId=nextGameId++,seed=Math.floor(Math.random()*2147483647),maze=generateMaze(MAZE_WIDTH,MAZE_HEIGHT,seed);
    const spawn1X=1*CELL_SIZE+CELL_SIZE/2,spawn1Z=1*CELL_SIZE+CELL_SIZE/2,spawn2X=(MAZE_WIDTH-2)*CELL_SIZE+CELL_SIZE/2,spawn2Z=(MAZE_HEIGHT-2)*CELL_SIZE+CELL_SIZE/2;
    const game={id:gameId,seed,maze,walls:mazeToWalls(maze,CELL_SIZE),players:[waitingPlayer,ws],state:'countdown',rematchVotes:new Set()};games.set(gameId,game);
    Object.assign(waitingPlayer.playerData,{gameId,playerId:0,hp:MAX_HP,x:spawn1X,z:spawn1Z});Object.assign(ws.playerData,{gameId,playerId:1,hp:MAX_HP,x:spawn2X,z:spawn2Z});
    sendJSON(waitingPlayer,{type:'start',seed,spawnX:spawn1X,spawnZ:spawn1Z,playerId:0,mazeWidth:MAZE_WIDTH,mazeHeight:MAZE_HEIGHT});
    sendJSON(ws,{type:'start',seed,spawnX:spawn2X,spawnZ:spawn2Z,playerId:1,mazeWidth:MAZE_WIDTH,mazeHeight:MAZE_HEIGHT});
    setTimeout(()=>{if(game.state==='countdown'){game.state='playing';for(const p of game.players)sendJSON(p,{type:'go'});}},3000);
    waitingPlayer=null;
  }else{waitingPlayer=ws;sendJSON(ws,{type:'waiting'});}
}
function handlePosition(ws,msg){const game=games.get(ws.playerData.gameId);if(!game)return;Object.assign(ws.playerData,{x:msg.x,y:msg.y,z:msg.z,rotY:msg.rotY,rotX:msg.rotX});const opponent=getOpponent(game,ws);if(opponent)sendJSON(opponent,{type:'opponent_position',x:msg.x,y:msg.y,z:msg.z,rotY:msg.rotY,rotX:msg.rotX});}
function handleShoot(ws,msg){const game=games.get(ws.playerData.gameId);if(!game||game.state!=='playing')return;const opponent=getOpponent(game,ws);if(!opponent)return;const{origin,direction}=msg;if(!origin||!direction)return;const hit=raySphereIntersect(origin.x,origin.y,origin.z,direction.x,direction.y,direction.z,opponent.playerData.x,1.0,opponent.playerData.z,HIT_RADIUS);if(hit&&hit.distance<100&&!isLineBlocked(origin.x,origin.z,opponent.playerData.x,opponent.playerData.z,game.walls)){opponent.playerData.hp-=DAMAGE;const newHp=Math.max(0,opponent.playerData.hp);sendJSON(ws,{type:'hit',target:opponent.playerData.playerId,damage:DAMAGE});sendJSON(opponent,{type:'damaged',health:newHp,by:ws.playerData.playerId});if(newHp<=0){game.state='ended';sendJSON(ws,{type:'kill',winner:ws.playerData.playerId});sendJSON(opponent,{type:'kill',winner:ws.playerData.playerId});}}}
function handleRematch(ws){const game=games.get(ws.playerData.gameId);if(!game||game.state!=='ended')return;game.rematchVotes.add(ws.playerData.playerId);const opponent=getOpponent(game,ws);if(opponent)sendJSON(opponent,{type:'rematch_vote'});if(game.rematchVotes.size===2){games.delete(game.id);const newSeed=Math.floor(Math.random()*2147483647),newMaze=generateMaze(MAZE_WIDTH,MAZE_HEIGHT,newSeed),spawn1X=1*CELL_SIZE+CELL_SIZE/2,spawn1Z=1*CELL_SIZE+CELL_SIZE/2,spawn2X=(MAZE_WIDTH-2)*CELL_SIZE+CELL_SIZE/2,spawn2Z=(MAZE_HEIGHT-2)*CELL_SIZE+CELL_SIZE/2,newGameId=nextGameId++;const newGame={id:newGameId,seed:newSeed,maze:newMaze,walls:mazeToWalls(newMaze,CELL_SIZE),players:game.players,state:'countdown',rematchVotes:new Set()};games.set(newGameId,newGame);for(let i=0;i<2;i++){const p=game.players[i],sx=i===0?spawn1X:spawn2X,sz=i===0?spawn1Z:spawn2Z;Object.assign(p.playerData,{gameId:newGameId,hp:MAX_HP,x:sx,z:sz});sendJSON(p,{type:'start',seed:newSeed,spawnX:sx,spawnZ:sz,playerId:i,mazeWidth:MAZE_WIDTH,mazeHeight:MAZE_HEIGHT});}setTimeout(()=>{if(newGame.state==='countdown'){newGame.state='playing';for(const p of newGame.players)sendJSON(p,{type:'go'});}},3000);}}
function handleDisconnect(ws){if(waitingPlayer===ws){waitingPlayer=null;return;}const game=games.get(ws.playerData.gameId);if(game){const opponent=getOpponent(game,ws);if(opponent){sendJSON(opponent,{type:'opponent_left'});opponent.playerData.gameId=null;}games.delete(game.id);}}
function getOpponent(game,ws){return game.players.find(p=>p!==ws&&p.readyState===1);}
function sendJSON(ws,data){if(ws.readyState===1)ws.send(JSON.stringify(data));}
function raySphereIntersect(ox,oy,oz,dx,dy,dz,sx,sy,sz,radius){const lx=sx-ox,ly=sy-oy,lz=sz-oz,tca=lx*dx+ly*dy+lz*dz,d2=lx*lx+ly*ly+lz*lz-tca*tca,r2=radius*radius;if(d2>r2)return null;const thc=Math.sqrt(r2-d2),t0=tca-thc,t1=tca+thc;if(t1<0)return null;return{distance:t0<0?t1:t0};}
function isLineBlocked(x1,z1,x2,z2,walls){for(const wall of walls)if(lineSegmentsIntersect(x1,z1,x2,z2,wall.x1,wall.z1,wall.x2,wall.z2))return true;return false;}
function lineSegmentsIntersect(ax1,ay1,ax2,ay2,bx1,by1,bx2,by2){const d1x=ax2-ax1,d1y=ay2-ay1,d2x=bx2-bx1,d2y=by2-by1,cross=d1x*d2y-d1y*d2x;if(Math.abs(cross)<1e-10)return false;const ddx=bx1-ax1,ddy=by1-ay1,t=(ddx*d2y-ddy*d2x)/cross,u=(ddx*d1y-ddy*d1x)/cross;return t>.01&&t<.99&&u>.01&&u<.99;}
httpServer.listen(PORT,'0.0.0.0',()=>console.log(`VieraStrike FPS Arena control test listening on ${PORT}`));
