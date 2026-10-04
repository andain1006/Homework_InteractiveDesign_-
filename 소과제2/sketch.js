let lv,s,a,b,n,lt,t,vy;
const R=()=>min(width,height)*.09;
function setup(){createCanvas(windowWidth,windowHeight);
textAlign(CENTER,CENTER);
start(1);}

function start(l){lv=l;
s='wait';
n=0;
lt=0;
vy=0;
b=null;
a={x:width/2,y:height*.28,body:true};}

function ap(x,y,body){
const r=R();
noStroke();
if(body){fill(140,205,80);
ellipse(x,y,r*2,r*1.9);}
stroke(110,75,40);
strokeWeight(r*.12);
strokeCap(ROUND);
line(x,y-r*.8,x+r*.08,y-r*1.3);
noStroke();
fill(70,160,60);
push();
translate(x+r*.4,y-r*1.12);
rotate(-.5);
ellipse(0,0,r*.7,r*.32);
pop();}

function draw(){
background(255,250,235);
let ox=0;
if(s=='done'&&millis()-t>700)start(2);
if(s=='shake'){const p=(millis()-t)/1200;
if(p>=1){s='fall';
vy=0;}
else ox=sin(p*TWO_PI*3)*R()*.3;}
if(s=='drag'){b.vx=lerp(b.vx,mouseX-b.x,.6);
b.vy=lerp(b.vy,mouseY-b.y,.6);
b.x=mouseX;
b.y=mouseY;}
if(s=='thrown'){
b.x+=b.vx;
b.y+=b.vy;
b.vx*=.985;
b.vy*=.985;
if(b.x<R()||b.x>width-R()){b.vx*=-1;
b.x=constrain(b.x,R(),width-R());}
if(b.y<R()||b.y>height-R()){b.vy*=-1;
b.y=constrain(b.y,R(),height-R());}
if(dist(a.x,a.y,b.x,b.y)<R()*1.9){s='fall';
vy=0;}
else if(mag(b.vx,b.vy)<.5)s='ready';}
if(s=='fall'){
vy+=.5;
a.y+=vy;
if(b)b.y+=vy;
if((b?min(a.y,b.y):a.y)>height+R()*2)start(lv%3+1);}
ap(a.x+ox,a.y,a.body);
if(b)ap(b.x,b.y,true);
fill(90);
noStroke();
textSize(28);
text('LEVEL '+lv,width/2,40);
textSize(18);
text(s=='wait'?['사과를 한 번 터치하세요','사과를 빠르게 두 번 터치하세요','화면을 빠르게 세 번 터치하세요'][lv-1]:(s=='ready'||s=='drag'||s=='thrown')?'새 사과를 드래그해서 던지세요':'',width/2,height-40);}

const hit=o=>dist(mouseX,mouseY,o.x,o.y)<R()*1.2;
function mousePressed(){
const m=millis();
if(lv==1&&s=='wait'&&hit(a)){a.body=false;
s='done';
t=m;}
else if(lv==2&&s=='wait'&&hit(a)){n=m-lt<600?n+1:1;
lt=m;
if(n==2){s='shake';
t=m;}}
else if(lv==3){
if(s=='ready'&&hit(b))s='drag';
else if(s=='wait'){n=m-lt<500?n+1:1;
lt=m;
if(n==3){b={x:width/2,y:height*.75,vx:0,vy:0};
s='ready';}}}
return false;}

function mouseDragged(){return false;}
function mouseReleased(){
if(s=='drag'){
const sp=mag(b.vx,b.vy);
if(sp>40){b.vx*=40/sp;
b.vy*=40/sp;}
s=sp>1?'thrown':'ready';}
return false;}

function windowResized(){resizeCanvas(windowWidth,windowHeight);
if(s!='fall'){a.x=width/2;
a.y=height*.28;}
if(b&&s!='fall'){b.x=constrain(b.x,R(),width-R());
b.y=constrain(b.y,R(),height-R());}}