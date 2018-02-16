


// #region Utilities

async function delay(timeInMilliseconds) {
    return await new Promise((resolve, reject) => setTimeout(resolve, timeInMilliseconds));
}

let createObjectFromKeys = function (
    keys,                   // array of strings.
    values,                 // object, or array of objects.
    defaultValue = null     // object.
) {
    if (keys && Array.isArray(keys)) {
        data = {};
        let valueIsArray = Array.isArray(values);
        for (let i = 0; i < keys.length; i++) {
            if (typeof keys[i] === "string")
                data[keys[i]] = valueIsArray ? (i < values.length ? values[i] : defaultValue) : values;
        }
        return data;
    } else {
        return keys;
    }
}

// #endregion Utilities



class Settings {
    constructor() {
        Object.assign(this, Settings.getDefaultValues());
    }

    static getDefaultValues() {
        return {
            timeBetweenUpdatesInMilliseconds: 100,
            windowPrefixFormat: '[%TabCount%] ',
            isEnabled: true,
        }
    }


    // #region Manage storage

    static async get(
        key,                    // string, array of string, or object (property names are keys and values are set values).
        defaultValue = null     // object, or array of objects. Ignored if key is an object (not string).
    ) {
        if (typeof key === "string") {
            return (await browser.storage.local.get({ [key]: defaultValue }))[key];
        } else {
            let data = createObjectFromKeys(key, defaultValue);
            return await browser.storage.local.get(data);
        }
    }
    static async set(
        key,            // string, array of string, or object (property names are keys and values are set values).
        value = null    // object, or array of objects. Ignored if key is an object (not string).
    ) {
        if (typeof key === "string") {
            return await browser.storage.local.set({
                [key]: value
            });
        } else {
            let data = createObjectFromKeys(key, value);
            return await browser.storage.local.set(data);
        }
    }
    static async remove(
        key     // string, or array of strings.
    ) {
        return browser.storage.local.remove(key);
    }
    static async clear() {
        return browser.storage.local.clear();
    }

    // #endregion Manage storage


    static createChangeEventListener(
        callback    // Function that will be called when this event occurs. The function will be passed the following arguments:
        // changes:    object. Object describing the change. This contains one property for each key that changed. The name of the property is the name of the key that changed, and its value is a storage.StorageChange object describing the change to that item.
        // areaName:   string. The name of the storage area ("sync", "local" or "managed") to which the changes were made.
    ) {
        return new EventListener(browser.storage.onChanged, callback);
    }
}



class SettingsTracker {
    constructor(
        storageArea = null,
        callback = null
    ) {
        if (!storageArea || typeof storageArea !== "string") {
            storageArea = "local";
        }

        this.settings = new Settings();

        let changedProperties = [];
        let changeListener = Settings.createChangeEventListener((changes, areaName) => {
            if (areaName === storageArea) {
                let keys = Object.keys(changes);
                if (changedProperties) {
                    changedProperties.push.apply(keys.filter((change) => !changedProperties.includes(change)));
                }
                for (let key of keys) {
                    let newValue = changes[key].newValue;
                    if (newValue) {
                        this.settings[key] = newValue;
                    } else {
                        delete this.settings[key];
                    }
                }
                try {
                    if (callback && typeof callback === "function") {
                        callback(changes, areaName);
                    }
                } catch (error) { }
            }
        });
        let start = async () => {
            let allSettings = await Settings.get(null);
            for (let key of Object.keys(allSettings)) {
                if (!changedProperties.includes(key)) {
                    this.settings[key] = allSettings[key];
                }
            }
            changedProperties = null;
        };

        this.start = start();
        this.stop = () => {
            changeListener.close();
        };
    }
}



class EventListener {
    constructor(event, callback) {
        this._callback = callback;
        this._event = event;
        this._event.addListener(this._callback);
    }

    close() {
        if (this._callback) {
            this._event.removeListener(this._callback)
            this._callback = null;
        }
    }
    get isDisposed() {
        return !Boolean(this._callback);
    }
    get isActive() {
        return this._event.hasListener(this._callback);
    }
}



class RequestSource {
    constructor(sourceId, requestInfo = {}) {
        this.id = sourceId;
        this.requestInfo = requestInfo;
        this.invalidated = true;

        this.blockTimeoutId = null;
    }

    invalidate(newRequestInfo) {
        this.invalidated = true;

        if (newRequestInfo) {
            this.requestInfo = newRequestInfo;
        }
    }
    grant() {
        let info = this.requestInfo;
        this.invalidated = false;
        this.requestInfo = {};
        return info;
    }
    block(time, callback) {
        if (this.blockTimeoutId || this.blockTimeoutId === 0) {
            clearTimeout(this.blockTimeoutId);
            this.blockTimeoutId = null;
        }
        this.blockTimeoutId = setTimeout(() => {
            this.blockTimeoutId = null;
            callback();
        }, time);
    }
}



class RequestManager {
    constructor(
        grantRequest,               // function (sourceId, requestInfo) return timeToBlockInMilliseconds
        handleInvalidated = null,   // function (soruceId, currentRequestInfo, newRequestInfo) return requestInfoToStore
    ) {
        this.grantRequest = grantRequest;
        this.handleInvalidated = handleInvalidated;

        this.blockedSources = [];
    }


    newRequest(sourceId, requestInfo) {
        if (requestInfo === undefined) {
            requestInfo = sourceId;
            sourceId = null;
        }
        if (!sourceId) {
            sourceId = 0;
        }


        let source = this.getSource(sourceId);
        if (source) {
            let infoGetter = this.handleInvalidated;
            if (!infoGetter) {
                infoGetter = RequestManager.defaultInvalidateHandling;
            }
            let newInfo = infoGetter(sourceId, source.requestInfo, requestInfo)

            source.invalidate(newInfo);
        } else {
            source = new RequestSource(sourceId, requestInfo);
            this.blockedSources.push(source);
            this.grantSource(source);
        }
    }
    async grantSource(source) {
        let blockTime = 0;
        while (source.invalidated && !blockTime) {
            try {
                let grantedRequestInfo = source.grant();
                if (this.grantRequest) {
                    blockTime = await this.grantRequest(source.id, grantedRequestInfo);
                }
            } catch (error) {
                blockTime = 0;
                console.log("Error on request handling!\n" + error)
            }
            if (blockTime) {
                if (!Number.isInteger(blockTime)) {
                    blockTime = Number(blockTime);
                    if (blockTime === NaN) {
                        blockTime = this.defaultBlockTimeInMilliseconds;
                    }
                }
                if (blockTime < 0)
                    blockTime = 0;
            } else {
                blockTime = Boolean(blockTime);
            }
        }

        if (!blockTime) {
            let index = this.blockedSources.indexOf(source);
            if (index >= 0) {
                this.blockedSources.splice(index, 1);
            }
        } else {
            source.block(blockTime, () => this.grantSource(source));
        }
        return blockTime;
    }
    getSource(sourceId) {
        let index = this.blockedSources.map(blockedSource => blockedSource.id).indexOf(sourceId);
        if (index < 0) {
            return null;
        } else {
            return this.blockedSources[index];
        }
    }


    static defaultInvalidateHandling(sourceId, currentRequestInfo, newRequestInfo) {
        return newRequestInfo;
    }
}
Object.assign(RequestManager, {
    defaultBlockTimeInMilliseconds: 200,
});


