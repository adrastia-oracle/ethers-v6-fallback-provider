import Timeout from "await-timeout";

export const promiseWithTimeout = async <T>(promise: Promise<T>, timeout: number): Promise<T> => {
    return Timeout.wrap(promise, timeout, "timeout exceeded");
};

export const wait = <T>(delay: number, returnValue?: T): Promise<T | undefined> =>
    new Promise((resolve) => setTimeout(() => resolve(returnValue), delay));

export const checkAnyResolved = async (promises: Promise<any>[]): Promise<any | null> => {
    return Promise.race([
        ...promises.map((p) =>
            p.then(
                (value) => ({ resolved: true, value }), // Capture resolved value
                () => ({ resolved: false }), // Capture rejection as unresolved
            ),
        ),
        new Promise((resolve) => setTimeout(() => resolve({ resolved: false }), 0)), // Immediate timeout
    ]).then((result: any) => (result.resolved ? result.value : null));
};

export const checkAllRejected = async (promises: Promise<any>[]): Promise<any[] | null> => {
    const results = await Promise.all(
        promises.map((p) =>
            Promise.race([
                p.then(
                    () => null, // Ignore resolved promises
                    (reason) => reason, // Capture rejected promise reason
                ),
                new Promise((resolve) => setTimeout(() => resolve(null), 0)), // Immediate timeout
            ]),
        ),
    );

    const rejectedValues = results.filter((value) => value !== null);

    return rejectedValues.length > 0 ? rejectedValues : null;
};
