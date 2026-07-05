// Magic Click Effect Utility
// Plays a synthesized magical twinkle sound and shows bursting sparkles.

let audioCtx = null;

const playMagicSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Frequencies for a magical fairy chime (Pentatonic/Lydian arpeggio)
    const notes = [880, 1108.73, 1318.51, 1760.00]; 
    
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      // 'sine' or 'triangle' works well for chimes
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      const startTime = audioCtx.currentTime + (i * 0.05);
      osc.start(startTime);
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      
      osc.stop(startTime + 0.4);
    });
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

const createSparkle = (x, y) => {
  const sparkle = document.createElement('div');
  
  // Randomize size and rotation
  const size = Math.random() * 15 + 10;
  const angle = Math.random() * 360;
  
  sparkle.innerText = ['✨', '✦', '⭐', '🌸'][Math.floor(Math.random() * 4)];
  
  sparkle.style.position = 'fixed';
  sparkle.style.left = `${x}px`;
  sparkle.style.top = `${y}px`;
  sparkle.style.fontSize = `${size}px`;
  sparkle.style.pointerEvents = 'none';
  sparkle.style.zIndex = '9999';
  sparkle.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
  sparkle.style.color = ['#f472b6', '#c084fc', '#fbbf24', '#ffffff'][Math.floor(Math.random() * 4)];
  sparkle.style.textShadow = '0 0 8px rgba(255,255,255,0.8)';
  
  document.body.appendChild(sparkle);
  
  // Animate it exploding outwards
  const destX = x + (Math.random() - 0.5) * 100;
  const destY = y + (Math.random() - 0.5) * 100 - 50; // Tend upwards
  
  const animation = sparkle.animate([
    { transform: `translate(-50%, -50%) rotate(${angle}deg) scale(0)`, opacity: 0 },
    { transform: `translate(-50%, -50%) rotate(${angle}deg) scale(1)`, opacity: 1, offset: 0.2 },
    { transform: `translate(calc(-50% + ${destX - x}px), calc(-50% + ${destY - y}px)) rotate(${angle + 180}deg) scale(0)`, opacity: 0 }
  ], {
    duration: 800 + Math.random() * 400,
    easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
  });
  
  animation.onfinish = () => {
    sparkle.remove();
  };
};

export const triggerMagicEffect = (e) => {
  try {
    // Play sound safely
    try {
      playMagicSound();
    } catch (err) {
      console.warn('Audio play failed', err);
    }
    
    // Create sparkles safely
    const count = Math.floor(Math.random() * 4) + 5;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        try {
          createSparkle(e.clientX, e.clientY);
        } catch (err) {
          console.warn('Sparkle creation failed', err);
        }
      }, i * 20);
    }
  } catch (globalErr) {
    console.error('Magic effect error', globalErr);
  }
};
