var sPlayer;

if (!isSamsung) {
	sPlayer = (function() {
		var currentChannelIndex = 0;
		var videoPlayer;
		function init() {}
		function gotoChannel(index) {
			if (!channelList[index] || typeof videojs !== 'function') return;
			currentChannelIndex = index;
			updateNowPlaying(channelList[index]);
			document.getElementById('channel-name').style.display = 'block';
			document.getElementById('loading').textContent = 'LOADING...';
			document.getElementById('loading').style.display = 'block';
			if (videoPlayer) videoPlayer.dispose();
			document.getElementById('player-container').innerHTML = '<video id="video-player" class="video-js vjs-big-play-centered" controls autoplay muted playsinline></video>';
			videoPlayer = videojs('video-player', {
				fluid: true,
				responsive: true,
				liveui: true,
				autoplay: true,
				muted: false,
				controls: true,
				preload: 'auto'
			});
			videoPlayer.on('playing', function() { document.getElementById('loading').style.display = 'none'; });
			videoPlayer.on('error', function() { document.getElementById('loading').textContent = 'Unable to play this stream.'; });
			videoPlayer.src({src: channelList[index].url, type: 'application/x-mpegURL'});
		}
		function channelUp() { gotoChannel((currentChannelIndex + 1) % channelList.length); }
		function channelDown() { gotoChannel((currentChannelIndex + channelList.length - 1) % channelList.length); }
		function handleShortcut(key) {
			if (!videoPlayer) return false;
			if (key === ' ') {
				if (videoPlayer.paused()) videoPlayer.play(); else videoPlayer.pause();
			} else if (key.toLowerCase() === 'f') {
				if (videoPlayer.isFullscreen()) videoPlayer.exitFullscreen(); else videoPlayer.requestFullscreen();
			} else if (key.toLowerCase() === 'm') {
				videoPlayer.muted(!videoPlayer.muted());
			} else if (key === 'ArrowLeft' || key === 'ArrowRight') {
				var currentTime = videoPlayer.currentTime() || 0;
				videoPlayer.currentTime(Math.max(0, currentTime + (key === 'ArrowLeft' ? -10 : 10)));
			} else {
				return false;
			}
			return true;
		}
		function stop() {
			if (!videoPlayer) return;
			videoPlayer.pause();
			videoPlayer.reset();
			videoPlayer.dispose();
			videoPlayer = null;
		}
		return {init:init, gotoChannel:gotoChannel, channelUp:channelUp, channelDown:channelDown, handleShortcut:handleShortcut, stop:stop};
	})();
} else {
	sPlayer = (function(){

	var currentChannelIndex = 0;
	var timerId = 0;
	var playerReady = false;
	var initRequested = false;
	var initRequestId = 0;
	var playTimerId = 0;
	var retryCount = 0;
	var playRequestId = 0;
	var maxRetries = 3;
	var paused = false;
	var muted = false;
	
	function callbackSuccess(avplayObj, requestId){
		if (!initRequested || requestId !== initRequestId) {
			return;
		}
		gAVplayObj = avplayObj;
		initRequested = false;
		gAVplayObj.init({
			containerID: 'player-container',
			displayRect:{
				width:1280,
				height:720,
				top:0,
				left:0
			},
			playCallback: wrapCallbacks({onerror:playErrorCallback}),
			autoRatio:false
		});
		playerReady = true;
		_play(channelList[currentChannelIndex] && channelList[currentChannelIndex].url, playRequestId);
	}
	
	function wrapCallbacks(callbacks) {
	    ///<summary>Wrap supplied callbacks in a logging statement. </summary>
	    for (var name in callbacks) {
	        (function (name, callback) {
	            callbacks[name] = function (value) {
	                value = value || '';
	                !!callback && callback.apply(this, arguments);
	            };
	        })(name, callbacks[name]);
	    }
	    return callbacks;
	}
	
	function callbackError(requestId){
		if (requestId !== initRequestId) {
			return;
		}
		console.log("Cannot get avplay object : ");
		initRequested = false;
	}
	
	function playSuccessCallback(){
		console.log("play successfull!!..");
		paused = false;
		$('#loading').hide();
	}
	
	function playErrorCallback(error, requestId){
		console.log("player play error = ", error);
		if (requestId !== undefined && requestId !== playRequestId) {
			return;
		}
		// Retry transient object and network errors, but stop after a bounded number of attempts.
		if(error && (error.code === 8 || error.code === 19) && retryCount < maxRetries) {
			retryCount++;
			_play(channelList && channelList[currentChannelIndex] && channelList[currentChannelIndex].url, playRequestId, 2000);
		}
	}
	
	var _init= function(){
		if (initRequested || playerReady) {
			return;
		}
		console.log("trying to init the player...");
		initRequested = true;
		var requestId = ++initRequestId;
		webapis.avplay.getAVPlay(function(avplayObj){
			callbackSuccess(avplayObj, requestId);
		}, function(){
			callbackError(requestId);
		});	
	};
	
	var _play = function(url, requestId, delay){
		if (!url || !channelList || !channelList.length) {
			console.log("Cannot play: no valid channel URL is available.");
			return;
		}
		if (!playerReady || !gAVplayObj) {
			return;
		}
		if (playTimerId) {
			clearTimeout(playTimerId);
		}
		var fullUrl = url.indexOf('.m3u8') >= 0 ? url + "|COMPONENT=HLS" : url;
		console.log("trying to play = " + fullUrl);
		try {
			gAVplayObj.stop();
		} catch (error) {
			console.log("player stop error = ", error);
		}

		playTimerId = setTimeout(function(){
			playTimerId = 0;
			if (requestId !== playRequestId || !playerReady) {
				return;
			}
			gAVplayObj.open(fullUrl);
			gAVplayObj.play(function(){
				if (requestId === playRequestId) {
					playSuccessCallback();
				}
			}, function(error){
				playErrorCallback(error, requestId);
			});
		}, delay || 1000);
	};
	
	var _showChannelName = function(){
		updateNowPlaying(channelList[currentChannelIndex]);
		$('#channel-name').show();
		$('#loading').show();
		if(timerId)
			clearTimeout(timerId);
		timerId = setTimeout(function(){
			$('#channel-name').hide();
		}, 4000);
		
	};
	
	var _gotoChannel = function(index){
		if (!channelList || !channelList.length || index < 0 || index >= channelList.length)
			return;
		currentChannelIndex = index;
		playRequestId++;
		retryCount = 0;
		_showChannelName();
		_play(channelList[index] && channelList[index].url, playRequestId);
		
	};
	
	var _channelUp = function(){
		if (!channelList || !channelList.length) {
			return;
		}
		currentChannelIndex = ++currentChannelIndex % channelList.length;
		_gotoChannel(currentChannelIndex);
	};
	
	var _channelDown = function(){
		if (!channelList || !channelList.length) {
			return;
		}
		currentChannelIndex = (--currentChannelIndex + channelList.length)   % channelList.length;
		_gotoChannel(currentChannelIndex);
	};

	var _handleShortcut = function(key){
		if (!playerReady || !gAVplayObj) return false;
		if (key === ' ') {
			if (paused) {
				gAVplayObj.play();
				paused = false;
			} else {
				gAVplayObj.pause();
				paused = true;
			}
		} else if (key.toLowerCase() === 'm' && gAVplayObj.setMute) {
			muted = !muted;
			gAVplayObj.setMute(muted ? 1 : 0);
		} else if (key === 'ArrowLeft' && gAVplayObj.jumpBackward) {
			gAVplayObj.jumpBackward(10);
		} else if (key === 'ArrowRight' && gAVplayObj.jumpForward) {
			gAVplayObj.jumpForward(10);
		} else {
			return false;
		}
		return true;
	};
	
	var _stop = function(){
		playRequestId++;
		paused = false;
		initRequestId++;
		playerReady = false;
		initRequested = false;
		if (playTimerId) {
			clearTimeout(playTimerId);
			playTimerId = 0;
		}
		if (timerId) {
			clearTimeout(timerId);
			timerId = 0;
		}
		if (gAVplayObj) {
			try {
				gAVplayObj.stop();
			} catch (error) {
				console.log("player stop error = ", error);
			}
			gAVplayObj = null;
		}
	};

	return {
		init		: _init,
		play		: _play,
		handleShortcut: _handleShortcut,
		gotoChannel	: _gotoChannel,
		channelUp	: _channelUp,
		channelDown	: _channelDown,
		stop		: _stop
	};
})();
}