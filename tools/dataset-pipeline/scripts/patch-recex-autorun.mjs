import fs from "node:fs/promises";
import path from "node:path";

const repoDir = process.argv[2];
if (!repoDir) {
  throw new Error("Usage: patch-recex-autorun.mjs <RecEx checkout>");
}

const modPath = path.join(repoDir, "src/main/java/com/bigbass/recex/RecipeExporterMod.java");
let source = await fs.readFile(modPath, "utf8");

source = source.replace(
  "import com.bigbass.recex.proxy.CommonProxy;",
  [
    "import com.bigbass.recex.proxy.CommonProxy;",
    "import com.bigbass.recex.recipes.RecipeExporter;",
    "",
    "import cpw.mods.fml.common.FMLCommonHandler;",
    "import cpw.mods.fml.common.event.FMLServerStartedEvent;",
  ].join("\n"),
);

source = source.replace(
  /(\s+@Mod\.EventHandler\s+public void init\(FMLInitializationEvent e\) \{\s+proxy\.init\(e\);\s+\}\s*)\}/,
  `$1

    @Mod.EventHandler
    public void serverStarted(FMLServerStartedEvent e) {
        if (!Boolean.getBoolean("recex.autorun")) {
            return;
        }

        Thread thread = new Thread(() -> {
            try {
                log.info("RecEx autorun export started.");
                RecipeExporter.getInst().run();
                log.info("RecEx autorun export finished.");
            } catch (Throwable t) {
                log.error("RecEx autorun export failed.", t);
                FMLCommonHandler.instance().exitJava(2, false);
                return;
            }

            FMLCommonHandler.instance().exitJava(0, false);
        });
        thread.setDaemon(false);
        thread.setName("recex-autorun-export");
        thread.start();
    }
}`,
);

await fs.writeFile(modPath, source);
