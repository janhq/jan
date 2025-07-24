// Robot Interactions - Make robots come alive with personality!

class RobotInteractions {
  constructor() {
    this.robots = [];
    this.mousePosition = { x: 0, y: 0 };
    this.isInitialized = false;

    // Robot moods and states
    this.moods = ['happy', 'curious', 'excited', 'sleepy', 'thinking'];
    this.currentMood = 'happy';

    // Easter egg: secret robot dance
    this.konami = [];
    this.konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  }

  init() {
    if (this.isInitialized) return;

    this.findRobots();
    this.setupEventListeners();
    this.startIdleAnimations();
    this.setupEasterEggs();

    this.isInitialized = true;
  }

  findRobots() {
    // Find all robot elements
    const robotElements = document.querySelectorAll('.robot-head, .robot-container, .model-robot, .platform-robot, .tool-robot');

    robotElements.forEach(robot => {
      const eyes = robot.querySelectorAll('.robot-eye');
      if (eyes.length > 0) {
        this.robots.push({
          element: robot,
          eyes: Array.from(eyes),
          originalPositions: Array.from(eyes).map(eye => {
            const rect = eye.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          }),
          isBlinking: false,
          mood: 'happy'
        });
      }
    });
  }

  setupEventListeners() {
    // Track mouse movement
    document.addEventListener('mousemove', (e) => {
      this.mousePosition = { x: e.clientX, y: e.clientY };
      this.updateEyes();
    });

    // Robot hover interactions
    this.robots.forEach(robot => {
      robot.element.addEventListener('mouseenter', () => this.onRobotHover(robot));
      robot.element.addEventListener('mouseleave', () => this.onRobotLeave(robot));
      robot.element.addEventListener('click', () => this.onRobotClick(robot));
    });

    // Keyboard interactions
    document.addEventListener('keydown', (e) => this.handleKeyPress(e));
  }

  updateEyes() {
    this.robots.forEach(robot => {
      if (robot.isBlinking) return;

      robot.eyes.forEach((eye, index) => {
        // Skip sleeping or closed eyes
        if (eye.classList.contains('sleeping') || eye.classList.contains('closed')) return;

        const eyeRect = eye.getBoundingClientRect();
        const eyeCenter = {
          x: eyeRect.left + eyeRect.width / 2,
          y: eyeRect.top + eyeRect.height / 2
        };

        // Calculate angle between eye and mouse
        const angle = Math.atan2(
          this.mousePosition.y - eyeCenter.y,
          this.mousePosition.x - eyeCenter.x
        );

        // Calculate distance (capped for natural movement)
        const distance = Math.min(
          Math.hypot(
            this.mousePosition.x - eyeCenter.x,
            this.mousePosition.y - eyeCenter.y
          ) / 10,
          3 // Maximum pupil movement
        );

        // Move the pupil (eye shine)
        const pupil = eye.querySelector('::after') || eye;
        const offsetX = Math.cos(angle) * distance;
        const offsetY = Math.sin(angle) * distance;

        // Apply transform to eye or create inner pupil
        if (!eye.querySelector('.pupil')) {
          const pupilElement = document.createElement('div');
          pupilElement.className = 'pupil';
          eye.appendChild(pupilElement);
        }

        const pupilElement = eye.querySelector('.pupil');
        if (pupilElement) {
          pupilElement.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        }
      });
    });
  }

  onRobotHover(robot) {
    // Add excited animation
    robot.element.classList.add('hover-active');

    // Make eyes bigger
    robot.eyes.forEach(eye => {
      eye.style.transform = 'scale(1.2)';
      eye.classList.add('excited');
    });

    // Add blush effect
    this.addBlush(robot);

    // Random reaction
    const reactions = ['happy', 'surprised', 'love'];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];

    if (reaction === 'love') {
      robot.eyes.forEach(eye => eye.classList.add('love'));
    }
  }

  onRobotLeave(robot) {
    robot.element.classList.remove('hover-active');

    // Reset eyes
    robot.eyes.forEach(eye => {
      eye.style.transform = '';
      eye.classList.remove('excited', 'love');
    });

    // Remove blush
    this.removeBlush(robot);
  }

  onRobotClick(robot) {
    // Trigger a fun animation
    this.makeRobotJump(robot);
    this.makeRobotSpeak(robot);

    // Easter egg: clicking 5 times makes robot do a dance
    if (!robot.clickCount) robot.clickCount = 0;
    robot.clickCount++;

    if (robot.clickCount >= 5) {
      this.robotDance(robot);
      robot.clickCount = 0;
    }
  }

  makeRobotJump(robot) {
    robot.element.style.animation = 'robotJump 0.6s ease-out';
    setTimeout(() => {
      robot.element.style.animation = '';
    }, 600);
  }

  makeRobotSpeak(robot) {
    const messages = [
      "Hello there! 👋",
      "Beep boop! 🤖",
      "AI at your service!",
      "Let's build something cool!",
      "Privacy first! 🔒",
      "Running locally! 💪",
      "*happy robot noises*",
      "01001000 01101001! (Hi in binary!)"
    ];

    const message = messages[Math.floor(Math.random() * messages.length)];
    this.showSpeechBubble(robot, message);
  }

  showSpeechBubble(robot, message) {
    // Remove existing bubble
    const existingBubble = robot.element.querySelector('.robot-speech-bubble');
    if (existingBubble) existingBubble.remove();

    // Create new bubble
    const bubble = document.createElement('div');
    bubble.className = 'robot-speech-bubble';
    bubble.innerHTML = `
      <span>${message}</span>
      <div class="bubble-tail"></div>
    `;

    robot.element.appendChild(bubble);

    // Remove after 3 seconds
    setTimeout(() => {
      bubble.classList.add('fade-out');
      setTimeout(() => bubble.remove(), 300);
    }, 3000);
  }

  startIdleAnimations() {
    // Random blinking
    setInterval(() => {
      this.robots.forEach(robot => {
        if (Math.random() < 0.1 && !robot.isBlinking) {
          this.makeRobotBlink(robot);
        }
      });
    }, 2000);

    // Random mood changes
    setInterval(() => {
      const robot = this.robots[Math.floor(Math.random() * this.robots.length)];
      if (robot && Math.random() < 0.3) {
        this.changeRobotMood(robot);
      }
    }, 5000);
  }

  makeRobotBlink(robot) {
    robot.isBlinking = true;

    robot.eyes.forEach(eye => {
      eye.style.transition = 'height 0.1s ease';
      eye.style.height = '2px';

      setTimeout(() => {
        eye.style.height = '';
        robot.isBlinking = false;
      }, 150);
    });
  }

  changeRobotMood(robot) {
    const moods = ['thinking', 'happy', 'curious'];
    const mood = moods[Math.floor(Math.random() * moods.length)];

    switch(mood) {
      case 'thinking':
        this.showThinkingBubbles(robot);
        break;
      case 'happy':
        this.makeRobotSmile(robot);
        break;
      case 'curious':
        this.makeRobotLookAround(robot);
        break;
    }
  }

  showThinkingBubbles(robot) {
    const bubbles = document.createElement('div');
    bubbles.className = 'thinking-bubbles';
    bubbles.innerHTML = `
      <div class="think-bubble small"></div>
      <div class="think-bubble medium"></div>
      <div class="think-bubble large">💭</div>
    `;

    robot.element.appendChild(bubbles);

    setTimeout(() => {
      bubbles.classList.add('fade-out');
      setTimeout(() => bubbles.remove(), 300);
    }, 3000);
  }

  makeRobotSmile(robot) {
    const smile = robot.element.querySelector('.robot-smile');
    if (smile) {
      smile.classList.add('big-smile');
      setTimeout(() => smile.classList.remove('big-smile'), 2000);
    }
  }

  makeRobotLookAround(robot) {
    let direction = -1;
    const lookInterval = setInterval(() => {
      robot.eyes.forEach(eye => {
        eye.style.transform = `translateX(${direction * 3}px)`;
      });
      direction *= -1;
    }, 500);

    setTimeout(() => {
      clearInterval(lookInterval);
      robot.eyes.forEach(eye => {
        eye.style.transform = '';
      });
    }, 2000);
  }

  addBlush(robot) {
    const head = robot.element.querySelector('.robot-head') || robot.element;

    ['left', 'right'].forEach(side => {
      const blush = document.createElement('div');
      blush.className = `robot-blush ${side}`;
      head.appendChild(blush);
    });
  }

  removeBlush(robot) {
    const blushes = robot.element.querySelectorAll('.robot-blush');
    blushes.forEach(blush => blush.remove());
  }

  setupEasterEggs() {
    // Konami code for robot dance party
    document.addEventListener('keydown', (e) => {
      this.konami.push(e.key);
      this.konami = this.konami.slice(-10);

      if (this.konami.join(',') === this.konamiCode.join(',')) {
        this.robotDanceParty();
      }
    });

    // Secret robot activation phrase
    let secretPhrase = '';
    document.addEventListener('keypress', (e) => {
      secretPhrase += e.key;
      secretPhrase = secretPhrase.slice(-10);

      if (secretPhrase.includes('robot')) {
        this.activateSecretRobotMode();
      }
    });
  }

  robotDanceParty() {
    document.body.classList.add('robot-dance-party');

    // Make all robots dance
    this.robots.forEach((robot, index) => {
      setTimeout(() => {
        this.robotDance(robot);
      }, index * 200);
    });

    // Add disco lights
    this.addDiscoLights();

    // Stop after 10 seconds
    setTimeout(() => {
      document.body.classList.remove('robot-dance-party');
      this.removeDiscoLights();
    }, 10000);
  }

  robotDance(robot) {
    robot.element.classList.add('dancing');

    // Random dance moves
    const dances = ['wiggle', 'spin', 'bounce', 'shake'];
    const dance = dances[Math.floor(Math.random() * dances.length)];

    robot.element.style.animation = `robot-${dance} 1s ease-in-out infinite`;

    setTimeout(() => {
      robot.element.style.animation = '';
      robot.element.classList.remove('dancing');
    }, 5000);
  }

  addDiscoLights() {
    const disco = document.createElement('div');
    disco.className = 'disco-lights';
    disco.innerHTML = `
      <div class="disco-ball">🪩</div>
      <div class="light-beam red"></div>
      <div class="light-beam blue"></div>
      <div class="light-beam green"></div>
      <div class="light-beam yellow"></div>
    `;
    document.body.appendChild(disco);
  }

  removeDiscoLights() {
    const disco = document.querySelector('.disco-lights');
    if (disco) disco.remove();
  }

  activateSecretRobotMode() {
    // Make all robots super happy
    this.robots.forEach(robot => {
      robot.eyes.forEach(eye => {
        eye.classList.add('sparkle', 'rainbow');
      });

      this.showSpeechBubble(robot, "Secret mode activated! 🎉");
    });

    // Remove after 5 seconds
    setTimeout(() => {
      this.robots.forEach(robot => {
        robot.eyes.forEach(eye => {
          eye.classList.remove('sparkle', 'rainbow');
        });
      });
    }, 5000);
  }

  handleKeyPress(e) {
    // Number keys change robot expressions
    if (e.key >= '1' && e.key <= '9') {
      const expressions = ['happy', 'sad', 'surprised', 'angry', 'love', 'sleepy', 'wink', 'dizzy', 'cool'];
      const expression = expressions[parseInt(e.key) - 1];

      if (expression) {
        this.robots.forEach(robot => {
          this.setRobotExpression(robot, expression);
        });
      }
    }
  }

  setRobotExpression(robot, expression) {
    // Clear previous expressions
    const allExpressions = ['happy', 'sad', 'surprised', 'angry', 'love', 'sleepy', 'wink', 'dizzy', 'cool'];
    robot.eyes.forEach(eye => {
      allExpressions.forEach(exp => eye.classList.remove(exp));
      eye.classList.add(expression);
    });

    // Remove after 3 seconds
    setTimeout(() => {
      robot.eyes.forEach(eye => {
        eye.classList.remove(expression);
      });
    }, 3000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.robotInteractions = new RobotInteractions();
    window.robotInteractions.init();
  });
} else {
  window.robotInteractions = new RobotInteractions();
  window.robotInteractions.init();
}

// Add required styles dynamically
const style = document.createElement('style');
style.textContent = `
  /* Pupil for eye tracking */
  .robot-eye .pupil {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 40%;
    height: 40%;
    background: white;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: transform 0.1s ease-out;
    pointer-events: none;
  }

  /* Speech bubble */
  .robot-speech-bubble {
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    color: #1A1A2E;
    padding: 0.75rem 1rem;
    border-radius: 20px;
    border: 3px solid #1A1A2E;
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    animation: bubbleIn 0.3s ease-out;
    z-index: 100;
  }

  .robot-speech-bubble.fade-out {
    animation: bubbleOut 0.3s ease-in forwards;
  }

  .bubble-tail {
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 10px solid white;
  }

  .bubble-tail::before {
    content: '';
    position: absolute;
    bottom: 2px;
    left: -10px;
    width: 0;
    height: 0;
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-top: 12px solid #1A1A2E;
  }

  /* Thinking bubbles */
  .thinking-bubbles {
    position: absolute;
    top: -40px;
    right: -20px;
    animation: bubbleFloat 3s ease-in-out;
  }

  .thinking-bubbles.fade-out {
    animation: fadeOut 0.3s ease-in forwards;
  }

  .think-bubble {
    position: absolute;
    background: white;
    border: 2px solid #1A1A2E;
    border-radius: 50%;
  }

  .think-bubble.small {
    width: 8px;
    height: 8px;
    bottom: 0;
    left: 0;
  }

  .think-bubble.medium {
    width: 12px;
    height: 12px;
    bottom: 10px;
    left: -5px;
  }

  .think-bubble.large {
    width: 30px;
    height: 30px;
    bottom: 25px;
    left: -15px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
  }

  /* Big smile animation */
  .robot-smile.big-smile {
    width: 30px !important;
    height: 15px !important;
    border-width: 4px !important;
  }

  /* Dance animations */
  @keyframes robot-wiggle {
    0%, 100% { transform: rotate(-5deg); }
    50% { transform: rotate(5deg); }
  }

  @keyframes robot-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes robot-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-20px); }
  }

  @keyframes robot-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }

  @keyframes robotJump {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-30px) scale(1.1); }
  }

  @keyframes bubbleIn {
    0% { opacity: 0; transform: translateX(-50%) scale(0.8); }
    100% { opacity: 1; transform: translateX(-50%) scale(1); }
  }

  @keyframes bubbleOut {
    0% { opacity: 1; transform: translateX(-50%) scale(1); }
    100% { opacity: 0; transform: translateX(-50%) scale(0.8); }
  }

  @keyframes fadeOut {
    0% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes bubbleFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }

  /* Disco mode */
  .disco-lights {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 9999;
  }

  .disco-ball {
    position: absolute;
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 60px;
    animation: discoSpin 2s linear infinite;
  }

  .light-beam {
    position: absolute;
    top: 100px;
    left: 50%;
    width: 100px;
    height: 500px;
    opacity: 0.3;
    transform-origin: top center;
    animation: lightSweep 4s ease-in-out infinite;
  }

  .light-beam.red { background: linear-gradient(transparent, #FF006E); }
  .light-beam.blue { background: linear-gradient(transparent, #3A86FF); animation-delay: 1s; }
  .light-beam.green { background: linear-gradient(transparent, #06FFA5); animation-delay: 2s; }
  .light-beam.yellow { background: linear-gradient(transparent, #FFB700); animation-delay: 3s; }

  @keyframes discoSpin {
    0% { transform: translateX(-50%) rotate(0deg); }
    100% { transform: translateX(-50%) rotate(360deg); }
  }

  @keyframes lightSweep {
    0%, 100% { transform: translateX(-50%) rotate(-30deg); }
    50% { transform: translateX(-50%) rotate(30deg); }
  }

  /* Rainbow eyes */
  .robot-eye.rainbow {
    animation: rainbowEyes 2s linear infinite;
  }

  @keyframes rainbowEyes {
    0% { background: #FF006E; }
    25% { background: #3A86FF; }
    50% { background: #06FFA5; }
    75% { background: #FFB700; }
    100% { background: #FF006E; }
  }

  /* Sparkle effect */
  .robot-eye.sparkle::before {
    content: '✨';
    position: absolute;
    top: -10px;
    right: -10px;
    font-size: 12px;
    animation: sparkleFloat 1s ease-in-out infinite;
  }

  @keyframes sparkleFloat {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-5px) rotate(180deg); }
  }
`;

document.head.appendChild(style);
