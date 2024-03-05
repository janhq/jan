export default function HomepageTerinaryFeatures() {
    return (
        <section className="py-20 flex items-center">
            <div className="container">
                <div className="flex justify-center flex-wrap gap-8">
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/roket.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">Get Started</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Easily kick off your journey with Jan by installing your AI locally.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/"} className="    dark:text-blue-400">
                                        Quickstart
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/install/"} className="dark:text-blue-400">
                                        Installation
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/models-list/"} className="dark:text-blue-400">
                                        Pre-configured Models
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/buku.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">Settings</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Discover how to manage Jan and configure your installed AI.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/thread/"} className="dark:text-blue-400">
                                        Thread Management
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/start-server/"} className="dark:text-blue-400">
                                        Local Server
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/advanced-settings/"} className="dark:text-blue-400">
                                        Advanced Settings
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/setting.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">Features</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Explore key features designed to enhance your experience with Jan.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/models-setup/"} className="dark:text-blue-400">
                                        Models Setup
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/extensions/"} className="dark:text-blue-400">
                                        Extensions
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/integrations/"} className="dark:text-blue-400">
                                        Integrations
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/doa.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">Troubleshooting</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Find solutions to common issues, including error codes, and FAQs.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/error-codes/"} className="dark:text-blue-400">
                                        Error Codes
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/common-error/"} className="dark:text-blue-400">
                                        Common Errors
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/faqs/"} className="dark:text-blue-400">
                                        FAQ
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}