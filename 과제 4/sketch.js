const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const MatterBody = Matter.Body;

let engine; // 엔진 객체
let stars = []; // 생성될 별들을 담을 배열
let maxStars = 350; // 화면을 가득 채우기 위해 개수 대폭 증가

// 별 색상 팔레트
let starColors = [
  "#FF5964", "#FFE5D9", "#FFCAD4", "#F4ACB7", "#68D8D6", 
  "#07B1CA", "#3D5A80", "#EE6C4D", "#FBC531", "#4CD137"
];

function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);

  // Matter setting
  engine = Engine.create();
  engine.gravity.y = 1.2; // 조금 더 빠르게 떨어지도록 중력 약간 증가

  // Walls (바닥, 왼쪽 벽, 오른쪽 벽) - 두께를 두껍게 해 사이로 빠져나가지 않게 설정
  let wallThickness = 100;
  Composite.add(engine.world, [
    // 바닥
    Bodies.rectangle(width / 2, height + wallThickness / 2 - 10, width * 2, wallThickness, { isStatic: true }),
    // 왼쪽 벽
    Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true }),
    // 오른쪽 벽
    Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height * 2, { isStatic: true }),
  ]);
}

function draw() {
  Engine.update(engine);
  background(20, 24, 33); // 어두운 밤하늘 배경

  // 1. 빠른 주기로 별을 생성하여 화면에 빽빽하게 쌓이도록 연출 (4프레임마다 생성)
  if (frameCount % 4 === 0 && stars.length < maxStars) {
    let x = random(30, width - 30);
    let size = random(18, 32); // 개수가 많이 쌓이도록 크기를 적절히 조절
    
    // 수업에서 다룬 Bodies.polygon 사용
    let star = Bodies.polygon(x, -30, 5, size, {
      restitution: 0.2, // 반발력을 낮춰 서로 튕겨 나가지 않고 잘 안착되게 설정
      friction: 0.8,    // 마찰력을 높여 층층이 잘 쌓이게 설정
      density: 0.003,   // 무게감 추가
      fill: random(starColors)
    });

    // 약간의 회전력 부여
    MatterBody.setAngularVelocity(star, random(-0.05, 0.05));

    stars.push(star);
    Composite.add(engine.world, star);
  }

  // 2. 수업 방식 그대로 Vertices를 순회하며 별 그리기
  for (let star of stars) {
    beginShape();
    fill(star.fill);
    stroke(255, 180);
    strokeWeight(1.5);
    for (let i = 0; i < star.vertices.length; i++) {
      let x = star.vertices[i].x;
      let y = star.vertices[i].y;
      vertex(x, y);
    }
    endShape(CLOSE);
  }
}