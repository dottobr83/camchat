var room = window.location.pathname.replace(/\//g,'');
var sock = new SockJS('/sockjs/camchat');
var peer = {};
var local_stream = {};
var my_id;
var audio_worker = new Worker("/webchat/js/audio_energy_worker.js");
var number_of_peers = 0;
var LOG_LEVEL = 9;
var front_window;

//drag & drop
var drag = undefined;
var slide = undefined;
var x, y;


function log(string, priority) {
    if(priority < LOG_LEVEL) {
        console.log(string);
    }
};

audio_worker.onmessage = function(event) { 
    log("audio_worker.onmessage" + event.data, 3);
    if(event.data.set_main){
        switch_main(event.data.set_main);
    }
};

$(document).ready(function() {
    $('.draggable').mousedown(function(e) {
        drag = $(this).parent()
        if(e.offsetX==undefined){
            x = e.pageX-target.offset().left;
            y = e.pageY-target.offset().top;
        }else{
            x = e.offsetX;
            y = e.offsetY;
        };
    });

    $('body').mouseup(function(e) {
        drag = undefined;
        slide = undefined;
    });
    $('body').mousemove(function(e) {
        if (drag) {
            drag.offset({
                top: e.pageY  - y,
                left: e.pageX - x
            });
        } 
        if(slide) {
            change_slider(slide, e);
        }
    });

});
function error_callback(error) {
    var click_settings = '<div class="click_link" onclick="draw_settings_div(\'Audio & Video Settings\')">see settings</div>';
    if(error.name == "PermissionDeniedError") {
        var hint = "did you allow your browser to use camera and mic?<br>";        
        show_message("Can't get audio & video", hint + click_settings);
    } else if(error.name == "DevicesNotFoundError") {
        var hint = "do you have any camera or mic connected?<br>";
        show_message("Can't get audio & video", hint + click_settings);
    } else if(error.name == "InvalidStateError") {
        var hint = "are you connected via https?<br>";
        show_message("Can't get audio & video", hint + click_settings);
    } else {
        console.log(error, 0);
    }
}

var pc_config = webrtcDetectedBrowser === 'firefox' ?
    {'iceServers': [{'url': 'stun:23.21.150.121'}]} : // number IP
    {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};

$.getScript("/webchat/js/control_panel.js");
$.getScript("/webchat/js/video.js");

function send(json_msg){
    sock.send(JSON.stringify(json_msg));
};

function send_audio_worker(msg){
    audio_worker.postMessage(msg);
};

//bring popups to front on click
$('#settings_window, #message_window, #ask_key_window').mousedown(function(){
    bring_to_front($(this));
});

function bring_to_front(window_div) {
    if( !window_div.is(front_window) ){
        front_window = window_div;
        window_div.parent().append(window_div);
    }
};

sock.onopen = function() {
    sock.send(JSON.stringify({'connect': room}));
};

sock.onmessage = function(e) {
    var json_msg = jQuery.parseJSON(e.data);
   
    if(json_msg.audio_energy){
        send_audio_worker(json_msg);
    } else if(json_msg.peer_connected) {
        add_peer(json_msg.peer_connected, json_msg.name, json_msg.browser_token);
    } else if(json_msg.connected){
        setup_videos(json_msg.user_id, json_msg.user_name, 
                json_msg.peer_list, json_msg.connected);
    } else if(json_msg.peer_disconnected) {
        remove_peer(json_msg.peer_disconnected);
    } else if(json_msg.offer){
        parse_offer(json_msg);
    } else if(json_msg.answer){
        var pc = peer[json_msg.callee].connection;
        pc.setRemoteDescription(new RTCSessionDescription(json_msg.answer));
    } else if(json_msg.ice_candidate){
        var pc = peer[json_msg.caller].connection;
        var candidate = new RTCIceCandidate({sdpMLineIndex:json_msg.ice_candidate.label,
                                            candidate:json_msg.ice_candidate.candidate});
        pc.addIceCandidate(candidate);
    } else if(json_msg.change_name){
        change_name(json_msg.change_name, json_msg.id);
    } else if(json_msg.init_stream) {
        init_video(json_msg.init_stream);
    } else if(json_msg.select_stream) {
        change_peer_stream(json_msg.id, json_msg.select_stream, json_msg.stream_name);
    } else if(json_msg.error == "wrong_key") {
        ask_key();
    } else if(json_msg.room_update == 'set_key' || json_msg.room_update == 'unset_key') {
        key_flag(json_msg.room_update);
    } else {
        log("sock.onmessage() -- unknown message",2);
        log(json_msg,2);
    }
};

sock.onclose = function() {
    show_message("Disconnected");
};

function parse_offer(json_msg){
    var pc = peer[json_msg.caller].connection;
    pc.setRemoteDescription(new RTCSessionDescription(json_msg.offer), function() {
        pc.createAnswer(function(answer) {
            pc.setLocalDescription(new RTCSessionDescription(answer), function() {
                send({'answer':answer, 'caller':json_msg.caller, 'callee':json_msg.callee});
            }, error_callback);
        }, error_callback);
    }, error_callback);
};

function setup_peer_connection(id, remote_video) {
    log('setup_peer_connection(' + id + ')', 1);
    var pc = peer[id].connection = new RTCPeerConnection(pc_config);

    pc.onicecandidate = function(event) {
        if (event.candidate) {
            send({ice_candidate: {
                    label: event.candidate.sdpMLineIndex,
                    id: event.candidate.sdpMid,
                    candidate: event.candidate.candidate},
                caller: my_id,
                callee: id});
        } 
    }
    pc.onaddstream = function(event) {
        log('pc.onaddstream', 2);
        if(peer[id].last_change_stream == event.stream.id || 
           peer[id].last_change_stream == undefined){
            peer[id].last_change_stream = event.stream.id;
            attachMediaStream(remote_video, event.stream);
            remote_video.play();
        }
    }
    pc.onremovestream = function(event) {
        log('pc.onremovestream', 2);
    }

    for(var i in local_stream){
        pc.addStream(local_stream[i]);
    }
    negotiate_connection(id);
    send({'select_stream': stream_id[current_stream], 'stream_name':current_stream});
}

function negotiate_connection(remote_id, force){
    log("negotiate_connection("+remote_id+")", 1);
    if((my_id > remote_id) || (force == true)){
        var pc = peer[remote_id].connection;
        pc.createOffer(function(offer) {
            pc.setLocalDescription(new RTCSessionDescription(offer), function() {
                send({'offer':offer, 'caller':my_id, 'callee':remote_id});
            }, error_callback);
        }, error_callback);
    }
}

//shows message window over the screen with text until it is hidden
function show_message(text, hint) {
    $('#message_window').fadeIn('slow');
    update_message(text, hint);
}

//updates message window over the screen with text if is visible
function update_message(text, hint) {
    if(hint){
        $("#message_window > .description").html('<b>'+text+'</b> <br>' + hint);
    } else {
        $("#message_window > .description").html(text);
    }
    bring_to_front($('#message_window'));
}

//hide message window
function hide_message(text, time) {
    $("#message_window > .description").html(text);
    $("#message_window").fadeOut(time);
}

//ask for key
function ask_key(){
    log("ask_key",0);
    var ask_key = $("<div>", {id: "ask_key_window"});
    var description = $("<div>", {class: "description"});
    description.html("Knock or unlock with key");
    var input_div = $("<div>");
    var input = $("<input>", {id: "ask_key", class: 'key', maxlength:"20"});
    input.change(function(){this.value = this.value.replace(/\W/g, '')});
    var button = $("<div>", {class: "button"});
    button.html("ok");
    
    ask_key.append(description);
    input_div.append(input);
    ask_key.append(input_div);
    ask_key.append(button);
    
    button.click(function(){
        sessionStorage.setItem("room_key", $("#ask_key").val());
        var settings_window = $(this).parent();
        settings_window.fadeOut("fast", function(){$(this).remove()});
        send_ready();
    });
    $("body").append(ask_key);
}

function key_flag(flag) {
    switch (flag) {
        case 'set_key':
            sessionStorage.setItem("room_key", 'unknown_key');
            break;
        case 'unset_key':
            sessionStorage.removeItem("room_key");
            break;
    }
}
