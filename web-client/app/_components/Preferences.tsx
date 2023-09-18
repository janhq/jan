"use client";
import { useEffect } from "react";
import {
  setup,
  plugins,
  extensionPoints,
  activationPoints,
} from "../../node_modules/pluggable-electron/dist/execution.es.js";
/* eslint-disable @next/next/no-sync-scripts */
export const Preferences = () => {
  useEffect(() => {
    async function setupPE() {
      // Enable activation point management
      setup({
        importer: (plugin) =>
          //@ts-ignore
          import(/* webpackIgnore: true */ plugin).catch((err) => {
            console.log(err);
          }),
      });

      // Register all active plugins with their activation points
      await plugins.registerActive();
    }
    setupPE();
    // Install a new plugin on clicking the install button
    document
      ?.getElementById("install-file")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        //@ts-ignore
        const pluginFile = new FormData(e.target).get("plugin-file").path;

        // Send the filename of the to be installed plugin
        // to the main process for installation
        const installed = await plugins.install([pluginFile]);
        console.log("Installed plugin:", installed);
      });

    // Uninstall a plugin on clicking uninstall
    document
      ?.getElementById("uninstall-plg")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        //@ts-ignore
        const pluginPkg = new FormData(e.target).get("plugin-pkg");

        // Send the filename of the to be uninstalled plugin
        // to the main process for removal
        //@ts-ignore
        const res = await plugins.uninstall([pluginPkg]);
        console.log(
          res
            ? "Plugin successfully uninstalled"
            : "Plugin could not be uninstalled"
        );
      });

    // Update all plugins on clicking update plugins
    document
      ?.getElementById("update-plgs")
      ?.addEventListener("click", async (e) => {
        const active = await plugins.getActive();
        plugins.update(active.map((plg) => plg.name));
        console.log("Plugins updated");
      });

    // Trigger the init activation point on clicking activate plugins
    document
      ?.getElementById("activate-plgs")
      ?.addEventListener("click", async (e) => {
        // Trigger activation point
        activationPoints.trigger("init");

        // Enable extend functionality now that extensions have been registered
        const buttons = document.getElementsByClassName("extend");
        //@ts-ignore
        for (const btn of buttons) {
          btn.disabled = false;
        }
        console.log('"Init" activation point triggered');
      });

    // Create a menu that can be extended through plugins
    document
      ?.getElementById("extend-menu")
      ?.addEventListener("click", async (e) => {
        // Get additional menu items from plugins, providing the desired parent item
        const menuItems = await Promise.all(
          extensionPoints.execute("extend-menu", "demo-parent-li")
        );
        // Insert items based on the parent and text provide by the plugin
        menuItems.forEach((item) => {
          const demoAnchor = document.createElement("a");
          demoAnchor.classList.add("nav-link");
          demoAnchor.href = "#";
          demoAnchor.innerText = item.text;

          const demoLi = document.createElement("li");
          demoLi.appendChild(demoAnchor);

          const parentId = item.hasOwnProperty("parent")
            ? item.parent
            : "demo-menu";
          document!.getElementById(parentId)!.appendChild(demoLi);
        });
      });

    // Calculate a cost based on plugin extensions
    document
      ?.getElementById("calc-price")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        //@ts-ignore
        const price = new FormData(e.target).get("price");
        // Get the cost, calculated in multiple steps, by the plugins
        const cost = await extensionPoints.executeSerial("calc-price", price);
        // Display result in the app
        document!.getElementById("demo-cost")!.innerText = cost;
      });

    // Provide image url to plugins to display as desired
    document
      ?.getElementById("display-img")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        //@ts-ignore
        const img = new FormData(e.target).get("img-url");
        // Provide image url to plugins
        extensionPoints.execute("display-img", img);
      });
  }, []);
  return (
    <div className="bg-light h-[100%] overflow-auto">
      <div className="container mx-auto my-5 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="col">
            <div className="bg-white shadow-md rounded-lg p-4">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold">
                  Manage plugin lifecycle
                </h2>
              </div>
              <div className="border-t border-gray-300 py-4">
                <form id="install-file">
                  <div className="flex items-end">
                    <div className="w-8/12">
                      <label className="block text-gray-700">
                        Package file:
                      </label>
                      <input
                        type="file"
                        name="plugin-file"
                        className="w-full p-2 border rounded-lg"
                      />
                    </div>
                    <div className="w-4/12 flex items-center justify-center">
                      <button className="bg-blue-500 text-white px-4 py-2 rounded-lg">
                        Install
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div className="border-t border-gray-300 py-4">
                <form id="uninstall-plg">
                  <div className="flex items-end">
                    <div className="w-8/12">
                      <label className="block text-gray-700">
                        Package name:
                      </label>
                      <input
                        type="text"
                        name="plugin-pkg"
                        className="w-full p-2 border rounded-lg"
                      />
                    </div>
                    <div className="w-4/12 flex items-center justify-center">
                      <button className="bg-blue-500 text-white px-4 py-2 rounded-lg">
                        Uninstall
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div className="border-t border-gray-300 py-4">
                <div className="flex justify-end">
                  <div className="w-4/12 flex items-center justify-center">
                    <button
                      className="bg-blue-500 text-white px-4 py-2 rounded-lg"
                      id="update-plgs"
                    >
                      Update plugins
                    </button>
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-300 py-4">
                <div className="flex justify-end">
                  <div className="w-4/12 flex items-center justify-center">
                    <button
                      className="bg-blue-500 text-white px-4 py-2 rounded-lg"
                      id="activate-plgs"
                    >
                      Activate plugins
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col">
            <div className="bg-white shadow-md rounded-lg p-4">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold">
                  Test Extension Points
                </h2>
              </div>
              <div className="border-t border-gray-300 py-4">
                <div className="flex">
                  <h4 className="text-lg font-semibold">Parallel execution</h4>
                </div>
                <div className="flex items-start">
                  <div className="w-8/12">
                    <p className="text-gray-700">Demo menu:</p>
                    <nav className="bg-light">
                      <div className="container mx-auto">
                        <div className="navbar-collapse">
                          <ul className="flex" id="demo-menu">
                            <li className="dropdown">
                              <a
                                href="#"
                                className="dropdown-toggle"
                                role="button"
                                data-bs-toggle="dropdown"
                                aria-expanded="false"
                              >
                                parent item
                              </a>
                              <ul
                                className="dropdown-menu"
                                id="demo-parent-li"
                              ></ul>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </nav>
                  </div>
                  <div className="w-4/12 flex items-center justify-center">
                    <button
                      className="bg-blue-500 text-white px-4 py-2 rounded-lg extend"
                      id="extend-menu"
                      disabled
                    >
                      Extend demo menu
                    </button>
                  </div>
                </div>
              </div>
              <div className="border-t border-gray-300 py-4">
                <div className="flex">
                  <h4 className="text-lg font-semibold">Serial execution</h4>
                </div>
                <form id="calc-price">
                  <div className="flex items-end">
                    <div className="w-8/12">
                      <label className="block text-gray-700">Demo price:</label>
                      <div className="input-group">
                        <span className="input-group-text">€</span>
                        <input
                          type="number"
                          step="0.01"
                          name="price"
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <p>
                        Cost: € <span id="demo-cost"></span>
                      </p>
                    </div>
                    <div className="w-4/12 flex items-center justify-center">
                      <button
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg extend"
                        disabled
                      >
                        Calculate cost
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div className="border-t border-gray-300 py-4">
                <div className="flex">
                  <h4 className="text-lg font-semibold">Handover</h4>
                </div>
                <form id="display-img">
                  <div className="flex items-end">
                    <div className="w-8/12">
                      <label className="block text-gray-700">Image url:</label>
                      <input
                        type="text"
                        name="img-url"
                        className="w-full p-2 border rounded-lg"
                      />
                    </div>
                    <div className="w-4/12 flex items-center justify-center">
                      <button
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg extend"
                        disabled
                      >
                        Display image
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              <div
                className="border-t border-gray-300 py-4"
                id="img-viewer"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
