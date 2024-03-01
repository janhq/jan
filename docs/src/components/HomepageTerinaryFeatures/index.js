import styles from "../HomepageTerinaryFeatures/styles.module.css";
import clsx from "clsx";

export default function HomepageTerinaryFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className={clsx(styles.cards)}>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/roket.png"}/>
                            <h3>Get Started</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Dive into the basics and get set up quickly.</p>
                            <ul>
                                <li>Quickstart</li>
                                <li>Installation</li>
                                <li>Pre-configured Models</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/buku.png"}/>
                            <h3>Settings</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Learn the best practices for optimizing thread management and local server use.</p>
                            <ul>
                                <li>Thread Management</li>
                                <li>Local Server</li>
                                <li>Advance Settings</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/setting.png"}/>
                            <h3>Features</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Explore our key features designed to enhance your experience.</p>
                            <ul>
                                <li>Advanced Models Setup</li>
                                <li>Extensions</li>
                                <li>Integrations</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/doa.png"}/>
                            <h3>Troubleshooting</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Find solutions to common issues, including error codes, frequent errors, and FAQs.</p>
                            <ul>
                                <li>Error Codes</li>
                                <li>Common Errors</li>
                                <li>FAQ</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}