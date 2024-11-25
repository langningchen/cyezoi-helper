import settings from "../settings";
import websocket from "./websocket";

export default class extends websocket {
    constructor(rid: string, callback: (record: any) => void) {
        super(`record-detail-conn?domainId=${settings.domain}&rid=${rid}`, (responseJSON: any) => {
            callback(responseJSON);
        });
    }
}