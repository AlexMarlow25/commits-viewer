const os = require("os");

// Work around environments where os.cpus() returns an empty list.
if (!os.cpus || os.cpus().length === 0) {
  os.cpus = () => [
    {
      model: "unknown",
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    },
  ];
}
