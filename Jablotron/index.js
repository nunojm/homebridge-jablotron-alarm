const JablotronClient = require('./jablotronClient.js');

module.exports = Jablotron;

function Jablotron(log, config, jablotronClient) {
    this.log = log;
    this.jablotronClient = jablotronClient;
    this.username = config['username'];
    this.password = config['password'];
    this.pincode = config['pincode'];
    this.serviceId = config['service_id'];
    this.segmentId = config['segment_id'];
    this.segmentKey = config['segment_key'];
    this.keyboardKey = null;

    var keyboard = config['keyboard_key'];
    if (keyboard && keyboard != null) {
        this.keyboardKey = keyboard;
    }

    this.sessionId = null;
}

Jablotron.prototype = {

    fetchServiceId: function(callback) {
        if (this.serviceId != null) {
            this.log('Using cached serviceId.');
            callback(this.serviceId);
            return;
        }

        var payload = { 'list_type': 'extended' };

        this.log('Obtaining serviceId.');
        var self = this;
        this.fetchSessionId(function(sessionId) {
            self.jablotronClient.doAuthenticatedRequest('/getServiceList.json', payload, sessionId, function(response) {
                var serviceId = response['services'][0]['id'];
                self.serviceId = serviceId;
                callback(serviceId);
            }, function(error){
                if (self.tryHandleError(error)){
                    self.fetchSessionId(callback);
                }
            });
        })
    },

    fetchSessionId: function(callback) {
        if (this.sessionId != null) {
            this.log('Using cached sessionId.');
            callback(this.sessionId);
            return;
        }

        var payload = {
            'login': this.username,
            'password': this.password
        };

        this.log('Obtaining sessionId.');
        var self = this;
        this.jablotronClient.doRequest('/login.json', payload, null, function(response) {
            var sessionId = response['session_id'];
            self.sessionId = sessionId;
            callback(sessionId);
        });
    },

    getSegmentState: function(type, callback) {
        var self = this;
        var segmentType = type;

        this.fetchServiceId(function(serviceId) {
            var payload = {
                'data': '[{"filter_data":[{"data_type":"' + segmentType + '"}],"service_type":"ja100","service_id":' + serviceId + ',"data_group":"serviceData","connect":true}]'
            };

            self.fetchSessionId(function(sessionId) {
                self.jablotronClient.doAuthenticatedRequest('/dataUpdate.json', payload, sessionId, function(response) {
                    var segments = response['data']['service_data'][0]['data'][0]['data']['segments'];
                    var segment_status = {};

                    segments.forEach((segment, index) => {
                        segment_status[segment['segment_key']] = segment['segment_state'];
                    });

                    callback(segment_status[self.segmentKey]);
                }, function(error) {
                    if (self.tryHandleError(error)) {
                        self.getSegmentState(segmentType, callback);
                    }
                });
            });
        });
    },

    switchSegmentState: function(state, callback) {
        var self = this;
        this.fetchServiceId(function(serviceId) {
            var keyboardOrSegmentKey = self.segmentKey;
            if (self.keyboardKey != null) {
                keyboardOrSegmentKey = self.keyboardKey;
            }

            var payload = {
                'service': 'ja100',
                'serviceId': serviceId,
                'segmentId': self.segmentId,
                'segmentKey': keyboardOrSegmentKey,
                'expected_status': state,
                'control_code': self.pincode,
            }

            self.log("Switching section " + self.segmentKey + " (using " + keyboardOrSegmentKey + ") to new state: " + state);

            self.fetchSessionId(function(sessionId) {
                self.jablotronClient.doAuthenticatedRequest('/controlSegment.json', payload, sessionId, function(response) {
                    var isStateChanged = response['segment_updates'].length != 0;
                    self.log('Was alarm state changed? ' + (isStateChanged ? "Yes" : "No"));
                    callback(isStateChanged);
                }, function(error){
                    if (self.tryHandleError(error)){
                        self.switchAlarmState(callback);
                    }
                });
            });
        });
    },

    deactivateSegment: function(callback) {
        this.switchSegmentState('unset', callback);
    },

    activateSegment: function(callback) {
        this.switchSegmentState('set', callback);
    },

    partiallyActivateSegment: function(callback) {
        this.switchSegmentState('partialSet', callback);
    },

    tryHandleError: function(error){
        if (error.message == 'not_logged_in') {
            this.log('Invalidating sessionId.');
            this.sessionId = null;
            return true;
        }
        else {
            this.log('Cannot handle error:');
            this.log(error);
            return false;
        }
    }
}
