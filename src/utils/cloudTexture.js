import * as THREE from 'three';

export function makeCloudTex() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  
  c.fillStyle = 'rgba(240, 248, 255, 0.63)';
  for (let i = 0; i < 26; i++) {
    c.beginPath();
    c.ellipse(Math.random() * S, Math.random() * S, 28 + Math.random() * 85, 6 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  
  return new THREE.CanvasTexture(cv);
}
