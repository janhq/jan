const { spawn } = require('child_process');
const fs = require('fs');

class NitroPlugin {
    constructor() {
        this.subprocess = null;
        this.binaryFolder = `${__dirname}/nitro`; // Current directory by default
        this.config = {};
    }

    /**
     * Install a model by writing a JSON file and executing a binary.
     * @param {string} modelPath - Path to the model.
     */
    installModel(modelPath) {
        // Check if there's an existing subprocess
        if (this.subprocess) {
            console.error('A subprocess is already running. Please uninstall the current model first.');
            return;
        }

        // Read the existing config
        const configFilePath = `${this.binaryFolder}/config/config.json`;
        let config = {};
        if (fs.existsSync(configFilePath)) {
            const rawData = fs.readFileSync(configFilePath, 'utf-8');
            config = JSON.parse(rawData);
        }

        // Update the llama_model_path
        if (!config.custom_config) {
            config.custom_config = {};
        }
        config.custom_config.llama_model_path = modelPath;

        // Write the updated config back to the file
        fs.writeFileSync(configFilePath, JSON.stringify(config, null, 4));

        // Execute the binary
        this.subprocess = spawn(`${this.binaryFolder}/nitro`, [configFilePath]);

        // Handle subprocess output
        this.subprocess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        this.subprocess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        this.subprocess.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            this.subprocess = null;
        });
    }

    /**
     * Uninstall the model by killing the subprocess.
     */
    uninstallModel() {
        if (this.subprocess) {
            this.subprocess.kill();
            this.subprocess = null;
            console.log('Subprocess terminated.');
        } else {
            console.error('No subprocess is currently running.');
        }
    }
}


const test = async () => {
    const nitro = new NitroPlugin();
    nitro.installModel('/Users/nam/Documents/janai/code/jan/models/llama-2-7b.Q4_K_S.gguf');
    // nitro.uninstallModel();
}
test()
// Export the functions
// module.exports = {
//     NitroPlugin,
//     installModel: (modelPath) => {
//         nitro.installModel(modelPath);
//     },
//     uninstallModel: () => {
//         nitro.uninstallModel();
//     }
// };
