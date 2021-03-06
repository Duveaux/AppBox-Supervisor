import { map } from "lodash";
const YAML = require("yaml");
const fs = require("fs");
var shell = require("shelljs");
import installScriptFunctions from "./InstallScript/install";

export default async (oldTask, models) => {
  // Vars
  const dir = `/AppBox/System/Temp/Apps/${oldTask.data.arguments.app.data.key}`;
  let result;
  console.log(
    `Starting install task for`,
    oldTask.data.arguments.app.data.name
  );
  const task = await models.objects.model.findOne({ _id: oldTask._id });

  // Announce that supervisor has started the work.
  await updateTask(task, 5, "Getting ready");

  if (oldTask.data.arguments.app.data.repository) {
    // Download
    result = await shell.exec(
      `git -C /AppBox/System/Temp/Apps clone ${oldTask.data.arguments.app.data.repository} ${oldTask.data.arguments.app.data.key}`
    );

    if (result.code === 128) {
      // Folder was alread there.
      console.log("Old code found. Checking updates.");

      await updateTask(task, 8, "Old code found. Checking updates.");
      await shell.exec(`git -C ${dir} pull`);
    }

    if (fs.existsSync(`${dir}/install.yml`)) {
      // Execute installscript
      await updateTask(task, 20, "Running pre-install scripts");

      const file = fs.readFileSync(`${dir}/install.yml`, "utf8");
      const installScript = YAML.parse(file);

      let scriptVersion = "script";
      // In case there's multiple versions based on the choices the user made, pick the right script
      if (installScript.versions) {
        installScript.versions.map((version) => {
          let match = true;
          map(version.criteria, (value, key) => {
            if (oldTask.data.arguments.choices[key] != value) {
              match = false;
            }
          });

          if (match) scriptVersion = version.script;
        });
      }

      // Execute the install script
      const script = installScript[scriptVersion || "script"];

      const data = installScript.data;
      let currentPercentage = 20;

      const stepSize = 80 / (script || []).length;

      await ((script as { action: string }[]) || []).reduce(
        async (prev, step) => {
          await prev;
          let action;
          let args = {
            info: script.info,
            key: oldTask.data.arguments.app.data.key,
            choices: oldTask.data.arguments.choices,
          };
          if (typeof step === "object") {
            action = step.action;
            args = { ...args, ...step };
          } else {
            action = step;
          }

          if (!installScriptFunctions[action]) {
            console.error(`Install script step ${action} not found.`);
            return false;
          }
          return await installScriptFunctions[action](
            args,
            models,
            data,
            async (state: string) => {
              currentPercentage += stepSize;
              await updateTask(task, currentPercentage, state);
            }
          );
        },
        (script || [])[0]
      );
      console.log("Done");

      // Done following install script
      await updateTask(task, 100, "Installation complete!");
    } else {
      task.data.progress = -1;
      task.data.state = "Install script missing";
      task.data.error = true;
      task.markModified("data.state");
      task.markModified("data.error");
      task.markModified("data.progress");
      await task.save();
    }
  } else {
    const app = oldTask.data.arguments.app.data.collection_data;
    const collection_data = app.collection_data;
    const script = collection_data.installScript.script;
    const data = collection_data.installScript.data;

    console.log("Installing collection based app.", data);
    console.log(data.models);

    let currentPercentage = 20;
    const stepSize = 80 / (script || []).length;

    await ((script as { action: string }[]) || []).reduce(
      async (prev, step) => {
        await prev;
        let action;
        let args = {
          key: oldTask.data.arguments.app.data.key,
        };
        if (typeof step === "object") {
          action = step.action;
          args = { ...args, ...step };
        } else {
          action = step;
        }

        if (!installScriptFunctions[action]) {
          console.error(`Install script step ${action} not found.`);
          return false;
        }
        return await installScriptFunctions[action](
          args,
          models,
          data,
          async (state: string) => {
            currentPercentage += stepSize;
            await updateTask(task, currentPercentage, state);
          }
        );
      },
      (script || [])[0]
    );

    console.log("Finished script. Registering app");
    await updateTask(task, 95, "Registering app");
    await new models.objects.model({ objectId: "apps", data: app }).save();
    await updateTask(task, 100, "Collection installed");
  }
};

const updateTask = (task, progress: number, state: string) =>
  new Promise<void>(async (resolve) => {
    task.data.progress = progress;
    task.data.state = state;
    task.markModified("data.state");
    task.markModified("data.progress");
    if (progress === 100) {
      task.data.done = true;
      task.markModified("data.done");
    }
    await task.save();
    resolve();
  });
