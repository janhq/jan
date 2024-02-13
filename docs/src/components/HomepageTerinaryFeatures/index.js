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
                            <p>Lorem ipsum dolor sit amet, consec tetur adipiscing.</p>
                            <ul>
                                <li>Overview</li>
                                <li>Quickstart</li>
                                <li>Installation</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/buku.png"}/>
                            <h3>Guides</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Lorem ipsum dolor sit amet, consec tetur adipiscing.</p>
                            <ul>
                                <li>Best Practices</li>
                                <li>Chat Management</li>
                                <li>Security</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/setting.png"}/>
                            <h3>Get Started</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Lorem ipsum dolor sit amet, consec tetur adipiscing.</p>
                            <ul>
                                <li>Advanced Models Setup</li>
                                <li>Extensions</li>
                                <li>Integrations</li>
                            </ul>
                        </div>
                    </div>
                    <div className={clsx(styles.card)}>
                        <div className={styles.cardHeader}>
                            <img alt={"Icon"} src={"/img/homepage-new/sdoa.png"}/>
                            <h3>Get Started</h3>
                        </div>
                        <div className={styles.cardContent}>
                            <p>Lorem ipsum dolor sit amet, consec tetur adipiscing.</p>
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
