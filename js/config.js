// ゲームの調整値。ここだけ触ればおおよその手触りは変えられる。
window.CONFIG = {
  // フィールドの論理サイズ（tools/build_assets.py の BOARD_W / BOARD_H と一致させること）
  board: { width: 400, height: 720 },

  // 壁の厚み（画面外に配置する）
  wallThickness: 80,

  // 地面の帯の高さ。物理の床の上面もここに合わせる
  // （合わせないとオブジェクトが地面に重なって沈んで見える）
  floorHeight: 10,

  // 上端からデッドラインまでの距離
  // 落下待機中のイラスト＋役職プレートの下端（004 で y≈130）より下に置くこと
  deadlineY: 128,

  // 落下待機オブジェクトの中心Y
  holdY: 55,

  // 落下してから次が出るまで
  dropCooldownMs: 450,

  // 落とせるのは 001〜004。値は出現の重み
  spawnWeights: [40, 30, 20, 10],

  maxStage: 11,

  // 001〜011 の役職名（配列の添字 = ステージ番号 - 1）
  titles: [
    'インターン', '平社員', '係長', '課長', '次長', '部長',
    '事業部長', '執行役員', '取締役', '副社長', '社長',
  ],

  physics: {
    gravity: 1.0,
    restitution: 0.15,   // 反発。上げるとよく跳ねる
    friction: 0.35,      // 表面摩擦
    frictionStatic: 0.6,
    frictionAir: 0.002,
    density: 0.0012,
    slop: 0.02,
    positionIterations: 8,
    velocityIterations: 6,
    enableSleeping: false,
  },

  gameOver: {
    settleSpeed: 0.7,    // この速度以下を「静止」とみなす
    graceMs: 1200,       // 落下直後はこの時間だけ判定から除外する
    overMs: 1000,        // ライン超過が継続したらゲームオーバー
  },

  // 合体で生まれたオブジェクトの猶予（落下直後より短くして上部での稼ぎ続けを防ぐ）
  mergeGraceMs: 400,

  // 連鎖ボーナス: 規定時間内に続けて合体すると倍率が上がる
  chain: { windowMs: 900, step: 0.5, max: 3.0 },

  // 011 同士が合体したときのボーナス（両方消滅する）
  topMergeBonus: 100,

  // 落下待機中に出す役職プレート
  //   gap    … イラスト下端からプレート中心までの距離。小さくすると上に寄る
  //            （height/2 = 11.5 を下回るとイラストに重なり始める）
  //   height … プレートの高さ
  label: { gap: 4, height: 23 },

  effect: { popMs: 300, floatMs: 800 },

  // 音量（0〜1）。sound.js は Web Audio で合成するので音声ファイルは不要
  sound: {
    master: 0.9,
    bgm: 0.20,
    sfx: 0.55,
    storageKey: 'shusse-game-muted',
  },

  storageKey: 'shusse-game-best',
};
