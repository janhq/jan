import styles from "../HomepageTerinaryFeatures/styles.module.css";
import clsx from "clsx";

export default function HomepageTerinaryFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className={clsx(styles.cards)}>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/roket.png"} />
                            <h3>Get Started</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Kick off your journey with Jan easily and install your AI locally.</p>
                            <ul>
                                <li>
                                    <a href={"/guides/"}>
                                        Quickstart
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/install/"}>
                                        Installation
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/models-list/"}>
                                        Pre-configured Models
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/buku.png"} />
                            <h3>Settings</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Learn how to manage the thread history and configure your installed AI.</p>
                            <ul>
                                <li>
                                    <a href={"/guides/thread/"}>
                                        Thread Management
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/start-server/"}>
                                        Local Server
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/advanced-settings/"}>
                                        Advanced Settings
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/setting.png"} />
                            <h3>Features</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Explore our key features designed to enhance your experience.</p>
                            <ul>
                                <li>
                                    <a href={"/guides/models-setup/"}>
                                        Models Setup
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/extensions/"}>
                                        Extensions
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/integrations/"}>
                                        Integrations
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/doa.png"} />
                            <h3>Troubleshooting</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Find solutions to common issues, including error codes, and FAQs.</p>
                            <ul>
                                <li>
                                    <a href={"/guides/error-codes/"}>
                                        Error Codes
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/common-error/"}>
                                        Common Errors
                                    </a>
                                </li>
                                <li>
                                    <a href={"/guides/faqs/"}>
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