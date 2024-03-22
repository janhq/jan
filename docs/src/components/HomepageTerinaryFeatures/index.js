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
                                    <a href={"/guides/quickstart"} className="    dark:text-blue-400">
                                        Quickstart
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/install/"} className="dark:text-blue-400">
                                        Installation
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/hardware/"} className="dark:text-blue-400">
                                        Hardware Setup
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/buku.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">User Guides</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Explore our comprehensive guide on configuring and using the Jan application.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/advanced/"} className="dark:text-blue-400">
                                        Advanced Settings
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/local-api/"} className="dark:text-blue-400">
                                        Local Server
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/threads/"} className="dark:text-blue-400">
                                        Manage Threads
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 w-72 rounded-lg relative flex flex-col p-8">
                        <div className="flex items-center gap-4">
                            <img alt={"Icon"} src={"/img/homepage-new/setting.png"} />
                            <h5 className="text-gray-700 dark:text-gray-200">Inference</h5>
                        </div>
                        <div className="mt-5 justify-center">
                            <p className="text-gray-700 dark:text-gray-200">Learn how to build and integrate Jan with local and remote inference providers.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/engines/"} className="dark:text-blue-400">
                                        Overview
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/engines/local/"} className="dark:text-blue-400">
                                        Local Providers
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/guides/engines/remote/"} className="dark:text-blue-400">
                                        Remote Providers
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
                            <p className="text-gray-700 dark:text-gray-200">Find solutions to common issues and including error codes.</p>
                            <ul className="mt-5">
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/troubleshooting/#broken-build"} className="dark:text-blue-400">
                                        Broken Build
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/troubleshooting/#somethings-amiss"} className="dark:text-blue-400">
                                        Something's Amiss
                                    </a>
                                </li>
                                <li className="font-semibold list-disc mb-4">
                                    <a href={"/troubleshooting/#unexpected-token"} className="dark:text-blue-400">
                                        Unexpected Token
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