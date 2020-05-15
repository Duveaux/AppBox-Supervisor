var mongoose = require("mongoose");
import taskFunctions from "./Utils/Tasks";

// Models
require("./Utils/Models/Objects");
require("./Utils/Models/Entries");
require("./Utils/Models/AppPermissions");
import { mongoDefaultConnection } from "./secrets";

mongoose.connect(
  `mongodb://${
    process.env.dbUrl ? process.env.dbUrl : mongoDefaultConnection
  }/AppBox?authSource=admin&readPreference=primaryPreferred&appname=AppBox-Supervisor&ssl=false`,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);
var db = mongoose.connection;
db.on("error", console.error.bind(console, "Connection error:"));
db.once("open", function () {
  // Models
  const models = {
    objects: {
      model: mongoose.model("Objects"),
      stream: db.collection("objects").watch(),
      listeners: {},
    },
    entries: {
      model: mongoose.model("Entries"),
      stream: db.collection("entries").watch(),
      listeners: {},
    },
    apppermissions: {
      model: mongoose.model("AppPermissions"),
    },
  };

  // Trigger functions
  const processTasks = (tasks) => {
    tasks.map((task) => {
      if (!task.data.done) {
        switch (task.data.action) {
          case "formula-calculate":
            taskFunctions.formula.calculate(task, models);
            break;
          case "box-update":
            taskFunctions.updates.update(task, models);
            break;
          case "app-install":
            if (task.data.progress === 0) {
              taskFunctions.general.installApp(task, models);
            }
            break;
          default:
            console.log(`Unknown task action ${task.data.action}`);
            break;
        }
      }
    });
  };
  models.entries.stream.on("change", (change) => {
    models.entries.model.find({ objectId: "system-task" }).then((tasks) => {
      processTasks(tasks);
    });
  });

  models.entries.model.find({ objectId: "system-task" }).then((tasks) => {
    processTasks(tasks);
  });

  console.log("Watching and executing tasks");
});
