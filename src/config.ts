// Central tuning. Every magic number lives here.

export const PHYSICS = {
  fixedDt: 1 / 120,
  maxSubSteps: 5,
  gravity: -13.5, // slightly heavy for grounded feel without float
} as const;

export const VEHICLE = {
  mass: 1280,
  chassisHalfExtents: { x: 0.92, y: 0.32, z: 2.15 },
  comYOffset: -0.18, // CoM below geometric center => stability + weight transfer
  wheelRadius: 0.36,
  wheelWidth: 0.28,
  suspensionStiffness: 46,
  suspensionRestLength: 0.34,
  maxSuspensionTravel: 0.3,
  dampingRelaxation: 2.6,
  dampingCompression: 4.6,
  frictionSlipBase: 2.35, // multiplied by surface grip
  rollInfluence: 0.04,
  // engine
  idleRpm: 800,
  redlineRpm: 7500,
  shiftUpRpm: 7100,
  shiftDownRpm: 3100,
  gearRatios: [-2.9, 0, 3.4, 2.35, 1.75, 1.38, 1.12, 0.94],
  finalDrive: 3.7,
  peakTorqueNm: 340,
  torqueCurveRpm: [1000, 2500, 4200, 5800, 7000, 7500], // rpm breakpoints
  torqueCurveVal: [0.62, 0.86, 1.0, 0.98, 0.88, 0.74], // fraction of peak
  drivetrainEfficiency: 0.9,
  brakeTorqueMaxNm: 2600,
  handbrakeTorqueNm: 2200,
  brakeBiasFront: 0.62,
  downforceCoeff: 2.4, // N per (m/s)^2
  dragCoeff: 0.42, // F = c * v^2
  rollingResistance: 12, // N constant-ish
  steerLockDegLowSpeed: 34,
  steerLockDegHighSpeed: 11,
  steerFullLockSpeed: 48, // m/s where high-speed lock reached
  steerResponseRate: 6.5, // 1/s toward target (keyboard smoothing)
  steerReturnRate: 8.0,
  yawAssistTorque: 900, // N*m cap of stability yaw damping at high slip
  yawAssistSlipStart: 0.55, // slip level where assist begins
  resetIfFlippedFor: 3.5, // s
  damageFromImpulse: 1 / 90000, // impulse N*s -> damage fraction
  maxDamagePowerLoss: 0.22, // at damage=1
  wheelPositions: [
    { x: -0.82, y: 0, z: 1.38 }, // FL
    { x: 0.82, y: 0, z: 1.38 }, // FR
    { x: -0.86, y: 0, z: -1.45 }, // RL
    { x: 0.86, y: 0, z: -1.45 }, // RR
  ],
} as const;

export const SURFACES: Record<string, { grip: number; rollDrag: number; label: string }> = {
  tarmac: { grip: 1.0, rollDrag: 0.013, label: 'tarmac' },
  kerb: { grip: 0.93, rollDrag: 0.02, label: 'kerb' },
  gravel: { grip: 0.62, rollDrag: 0.055, label: 'gravel' },
  dirt: { grip: 0.68, rollDrag: 0.045, label: 'dirt' },
  oil: { grip: 0.44, rollDrag: 0.01, label: 'oil' },
};

export const AI = {
  latAccelBase: 9.4, // m/s^2 steady-state cornering target
  latAccelSkillScale: 2.2, // added * skill
  brakeDecel: 9.0,
  lookaheadBase: 5.5, // m pure-pursuit, scales with speed below
  lookaheadPerSpeed: 0.42,
  steerP: 2.6,
  steerD: 0.12,
  avoidLookaheadTime: 1.1, // s
  avoidLateralGain: 3.2, // meters of offset per closing speed factor
  stuckSpeed: 1.2, // m/s below which stuck timer runs
  stuckTime: 2.6,
  reverseTime: 1.1,
  rubberBandRange: 90, // m gap where banding is full strength
  rubberBandMax: 0.075, // +-7.5% target speed
  skillSpread: [0.52, 0.68, 0.85], // one AI per value
} as const;

export const RACE = {
  lapsTotal: 3,
  countdownSeconds: 3.2,
  checkpointFracs: [0.3, 0.55, 0.8],
  wrongWayGrace: 2.0,
} as const;

export const CAMERA = {
  chaseDistance: 6.4,
  chaseHeight: 2.5,
  chaseStiffness: 26, // spring
  chaseDamping: 8.5,
  lookAhead: 9,
  fovBase: 60,
  fovPerSpeed: 16, // deg added at ~60 m/s
  fovImpactKick: 14, // deg max on hit
  fovRecovery: 3.2, // 1/s
  shakeFromImpulse: 1 / 45000,
  shakeDecay: 2.2,
  hoodHeight: 1.02,
  hoodForward: 0.25,
} as const;

export const GFX = {
  pixelRatioCap: 1.75,
  shadowMapSize: 2048,
  shadowRadius: 90, // world units covered by shadow frustum around player
  fogDensity: 0.0035,
  skidCapacity: 3000, // segments
  particleBudgets: { dust: 900, smoke: 500, spark: 350 },
  skyTop: 0x2e4a78,
  skyHorizon: 0xb8cbe0,
  sunColor: 0xfff2dd,
  hemiSky: 0x9db8d8,
  hemiGround: 0x6b6252,
} as const;

export const CAR_COLORS = [
  { paint: 0xc8452c, accent: 0xf2ede4, name: 'Vandal GT' }, // burnt orange coupe
  { paint: 0x2a5f8f, accent: 0xe8e8e8, name: 'Bison RT' }, // steel blue muscle
  { paint: 0xd8b23a, accent: 0x232323, name: 'Kei Comet' }, // mustard micro
  { paint: 0x495a52, accent: 0xd0d8cf, name: 'Longbow P1' }, // sage prototype
] as const;

export const AUDIO = {
  masterDefault: 0.75,
  engineBaseFreq: 42,
} as const;

