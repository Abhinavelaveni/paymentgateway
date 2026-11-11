package com.youpi.observer;

/**
 * Single switch for what this observer is allowed to read.
 *
 * Paytm-only mode: the app reads credit notifications posted by the Paytm app
 * (net.one97.paytm) and nothing else. Bank SMS and notifications from every other app are
 * discarded on-device before any parsing or network call.
 */
public final class ObserverPolicy {
    public static final String PAYTM_PACKAGE = "net.one97.paytm";

    private ObserverPolicy() {}

    public static boolean isObservedPackage(String packageName) {
        return PAYTM_PACKAGE.equals(packageName);
    }

    /** SMS is not read in Paytm-only mode; Paytm credits are taken from its notifications. */
    public static boolean isSmsObservationEnabled() {
        return false;
    }
}
