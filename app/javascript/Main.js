var isSamsung = typeof Common !== 'undefined' && typeof webapis !== 'undefined';
var widgetAPI = isSamsung ? new Common.API.Widget() : null;
var tvKey = isSamsung ? new Common.API.TVKeyValue() : {};
var pluginAPI = isSamsung ? new Common.API.Plugin() : null;
var Main = {};

var channelList = [];
var allChannels = [];
var fallbackChannelList = [
	{name:'Aaj Tak HD', url:'https://feeds.intoday.in/aajtak/api/aajtakhd/master.m3u8', categories:['News']},
	{name:'ABP Ananda', url:'https://d2l4ar6y3mrs4k.cloudfront.net/live-streaming/ananda-livetv/master.m3u8', categories:['News']}
];
var channelListUrl = 'https://iptv-org.github.io/iptv/countries/in.m3u';
var channelsApiUrl = 'https://iptv-org.github.io/api/channels.json';
var logosApiUrl = 'https://iptv-org.github.io/api/logos.json';
var categoriesApiUrl = 'https://iptv-org.github.io/api/categories.json';
var playerStarted = false;
var categoryNames = {};
var currentChannelPage = 1;
var refreshInProgress = false;

Main.onLoad = function() {
	this.enableKeys();
	if (isSamsung) {
		window.onShow = onShowEvent;
		widgetAPI.sendReadyEvent();
	} else {
		onShowEvent();
	}
};

function parseAttributes(line) {
	var attributes = {};
	var match;
	var expression = /([\w-]+)="([^"]*)"/g;
	while ((match = expression.exec(line))) attributes[match[1]] = match[2];
	return attributes;
}

function cleanChannelName(name) {
	return name
		.replace(/\s*\([^)]*\)\s*/g, ' ')
		.replace(/\s*\[[^\]]+\]\s*/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function normalizeCategories(value) {
	var values = Array.isArray(value) ? value : [value];
	var categories = [];
	values.forEach(function(item) {
		String(item || '').split(/[;,|]/).forEach(function(category) {
			category = category.trim();
			if (category && categories.indexOf(category) < 0) categories.push(category);
		});
	});
	return categories.length ? categories : ['Other'];
}

function placeholderLogoUrl(channelName) {
	return 'https://placehold.co/400x200/transparent/FFF?font=oswald&text=' + encodeURIComponent(channelName || 'Channel Name');
}

function handleLogoError(image) {
	var fallbackUrl = image.getAttribute('data-fallback-src');
	var placeholderUrl = image.getAttribute('data-placeholder-src') || placeholderLogoUrl(image.getAttribute('alt'));
	if (fallbackUrl && image.getAttribute('data-fallback-attempted') !== 'true') {
		image.setAttribute('data-fallback-attempted', 'true');
		image.src = fallbackUrl;
		return;
	}
	if (image.src !== placeholderUrl) image.src = placeholderUrl;
}

function parseM3U(text) {
	var channels = [], lines = text.split(/\r?\n/), current = null;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (line.indexOf('#EXTINF:') === 0) {
			var comma = line.lastIndexOf(',');
			var attrs = parseAttributes(line);
			current = {
				id: attrs['tvg-id'] || '', name: cleanChannelName(comma >= 0 ? line.substring(comma + 1).trim() : 'Unknown channel'),
				url: '', logo: attrs['tvg-logo'] || '', category: attrs['group-title'] || 'Other'
			};
		} else if (line && line.charAt(0) !== '#' && current) {
			current.url = line;
			channels.push(current);
			current = null;
		}
	}
	return channels;
}

function enrichChannels(parsed, metadata, logos) {
	var metadataById = {}, logoById = {};
	(metadata || []).forEach(function(item) { metadataById[item.id] = item; });
	(logos || []).forEach(function(item) {
		if (!logoById[item.channel]) logoById[item.channel] = [];
		if (item.url && logoById[item.channel].indexOf(item.url) < 0) logoById[item.channel].push(item.url);
	});
	return parsed.map(function(item) {
		var info = metadataById[item.id] || {};
		var logoOptions = logoById[item.id] || [];
		return {
			id: item.id, tvgId: item.id, name: cleanChannelName(item.name || info.name || 'Unknown channel'), url: item.url,
			logo: item.logo || logoOptions[0] || '', logoFallback: logoOptions.filter(function(url) { return url !== item.logo; })[0] || '',
			categories: normalizeCategories((info.categories && info.categories.length) ? info.categories : item.category),
			country: info.country || 'IN'
		};
	});
}

function renderChannelList() {
	var list = document.getElementById('channel-list');
	var grid = document.getElementById('channel-grid');
	var selector = document.getElementById('channel-selector');
	if (!list || !grid) return;
	list.innerHTML = '';
	grid.innerHTML = '';
	if (selector) selector.innerHTML = '';
	var pageSize = getChannelPageSize();
	var pageCount = Math.max(1, Math.ceil(channelList.length / pageSize));
	currentChannelPage = Math.min(currentChannelPage, pageCount);
	var pageStart = (currentChannelPage - 1) * pageSize;
	channelList.slice(pageStart, pageStart + pageSize).forEach(function(channel, pageIndex) {
		var index = pageStart + pageIndex;
		var option = document.createElement('option');
		option.value = index;
		option.textContent = channel.name;
		if (selector) selector.appendChild(option);
		var item = document.createElement('button');
		item.className = 'channel-card';
		var logoUrl = channel.logo || placeholderLogoUrl(channel.name);
		var placeholderUrl = placeholderLogoUrl(channel.name);
		item.innerHTML = '<img src="' + logoUrl + '" data-fallback-src="' + (channel.logoFallback || '') + '" data-placeholder-src="' + placeholderUrl + '" alt="' + channel.name + '" referrerpolicy="no-referrer" onerror="handleLogoError(this)">' +
			'<span><strong>' + channel.name + '</strong><small>' + channel.categories.join(' · ') + '</small></span>';
		item.onclick = function() { selectChannel(index); };
		list.appendChild(item);
		var card = document.createElement('button');
		card.className = 'channel-tile';
		card.innerHTML = '<span class="tile-logo"><img src="' + logoUrl + '" data-fallback-src="' + (channel.logoFallback || '') + '" data-placeholder-src="' + placeholderUrl + '" referrerpolicy="no-referrer" onerror="handleLogoError(this)" alt="' + channel.name + '"></span>' +
			'<span class="tile-copy"><strong>' + channel.name + '</strong><small>' + channel.categories.join(' · ') + '</small></span><span class="tile-play">▶</span>';
		card.onclick = function() { selectChannel(index); };
		grid.appendChild(card);
	});
	if (selector) selector.onchange = function() { selectChannel(parseInt(this.value, 10)); };
	var count = document.getElementById('channel-count');
	if (count) count.textContent = channelList.length + ' channels';
	renderChannelPagination(pageCount);
}

function getChannelPageSize() {
	var grid = document.getElementById('channel-grid');
	if (!grid) return 1;
	var viewportWidth = window.innerWidth;
	var gap = viewportWidth <= 900 ? 10 : 14;
	var tileHeight = viewportWidth <= 380 ? 190 : (viewportWidth <= 900 ? 160 : 184);
	var columns;
	if (viewportWidth <= 380) {
		columns = 1;
	} else if (viewportWidth <= 900) {
		columns = 2;
	} else {
		columns = Math.max(1, Math.floor((grid.clientWidth + gap) / (190 + gap)));
	}
	var gridTop = grid.getBoundingClientRect().top;
	var availableHeight = Math.max(tileHeight, window.innerHeight - gridTop - 64);
	var rows = Math.max(1, Math.floor((availableHeight + gap) / (tileHeight + gap)));
	return columns * rows;
}

function renderChannelPagination(pageCount) {
	var pagination = document.getElementById('channel-pagination');
	if (!pagination) return;
	pagination.innerHTML = '';
	if (pageCount <= 1) return;
	var previous = document.createElement('button');
	previous.type = 'button';
	previous.className = 'page-button';
	previous.textContent = '‹ Previous';
	previous.disabled = currentChannelPage === 1;
	previous.onclick = function() {
		if (currentChannelPage > 1) {
			currentChannelPage--;
			renderChannelList();
		}
	};
	var status = document.createElement('span');
	status.className = 'page-status';
	status.textContent = 'Page ' + currentChannelPage + ' of ' + pageCount;
	var next = document.createElement('button');
	next.type = 'button';
	next.className = 'page-button';
	next.textContent = 'Next ›';
	next.disabled = currentChannelPage === pageCount;
	next.onclick = function() {
		if (currentChannelPage < pageCount) {
			currentChannelPage++;
			renderChannelList();
		}
	};
	pagination.appendChild(previous);
	pagination.appendChild(status);
	pagination.appendChild(next);
}

function updateSyncStatus(message, isError) {
	var status = document.getElementById('sync-status');
	var label = status && status.querySelector('.sync-label');
	if (!status || !label) return;
	label.textContent = message;
	status.classList.toggle('is-error', !!isError);
}

function fetchFresh(url) {
	var separator = url.indexOf('?') >= 0 ? '&' : '?';
	return fetch(url + separator + '_refresh=' + Date.now(), {cache:'no-store'});
}

function fetchChannelData() {
	return Promise.all([
		fetchFresh(channelListUrl).then(function(response) { return response.text(); }),
		fetchFresh(channelsApiUrl).then(function(response) { return response.json(); }),
		fetchFresh(logosApiUrl).then(function(response) { return response.json(); }),
		fetchFresh(categoriesApiUrl).then(function(response) { return response.json(); })
	]);
}

function applyChannelData(results) {
	var parsed = parseM3U(results[0]);
	categoryNames = {};
	(results[3] || []).forEach(function(category) { categoryNames[category.id] = category.name; });
	allChannels = enrichChannels(parsed, results[1], results[2]);
	channelList = allChannels.slice();
	currentChannelPage = 1;
	renderCategories();
	renderChannelList();
}

function selectChannel(index) {
	if (!channelList[index]) return;
	var selector = document.getElementById('channel-selector');
	if (selector) selector.value = index;
	openPlayer();
	if (isSamsung) sPlayer.init();
	sPlayer.gotoChannel(index);
}

function updateNowPlaying(channel) {
	var logo = document.getElementById('channel-logo');
	var name = document.getElementById('channel-name');
	if (name) name.textContent = channel.name;
	if (!logo) return;
	logo.alt = channel.name + ' logo';
	logo.setAttribute('data-fallback-src', channel.logoFallback || '');
	logo.setAttribute('data-placeholder-src', placeholderLogoUrl(channel.name));
	logo.style.visibility = 'visible';
	logo.src = channel.logo || placeholderLogoUrl(channel.name);
}

function openPlayer() {
	var modal = document.getElementById('player-modal');
	if (!modal) return;
	modal.classList.add('is-open');
	modal.setAttribute('aria-hidden', 'false');
}

function closePlayer() {
	var modal = document.getElementById('player-modal');
	if (!modal) return;
	if (typeof sPlayer !== 'undefined' && sPlayer.stop) sPlayer.stop();
	modal.classList.remove('is-open');
	modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('DOMContentLoaded', function() {
	var close = document.getElementById('player-close');
	var modal = document.getElementById('player-modal');
	var refresh = document.getElementById('refresh-channels');
	if (close) close.onclick = closePlayer;
	if (modal) modal.onclick = function(event) { if (event.target === modal) closePlayer(); };
	document.addEventListener('keydown', function(event) {
		if (event.key === 'Escape') {
			closePlayer();
			return;
		}
		var target = event.target;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
		var modal = document.getElementById('player-modal');
		if (!modal || !modal.classList.contains('is-open') || typeof sPlayer === 'undefined' || !sPlayer.handleShortcut) return;
		if (sPlayer.handleShortcut(event.key)) event.preventDefault();
	});
	window.addEventListener('resize', function() { if (playerStarted) renderChannelList(); });
	if (refresh) refresh.onclick = function() { loadChannelsAndStart(true); };
});

function applyFilters() {
	var query = (document.getElementById('channel-search').value || '').toLowerCase();
	var category = document.getElementById('category-filter').value;
	channelList = allChannels.filter(function(channel) {
		return (!query || channel.name.toLowerCase().indexOf(query) >= 0) &&
			(!category || channel.categories.indexOf(category) >= 0);
	});
	currentChannelPage = 1;
	renderChannelList();
}

function renderCategories() {
	var filter = document.getElementById('category-filter');
	var categoryList = document.getElementById('category-list');
	if (!filter || !categoryList) return;
	var categories = {};
	allChannels.forEach(function(channel) {
		channel.categories.forEach(function(category) { categories[category] = true; });
	});
	filter.innerHTML = '<option value="">All categories</option>';
	categoryList.innerHTML = '';
	var categoryKeys = Object.keys(categories).sort();
	categoryKeys.forEach(function(category) {
		filter.innerHTML += '<option value="' + category + '">' + (categoryNames[category] || category) + '</option>';
		var item = document.createElement('button');
		item.className = 'category-item';
		item.textContent = categoryNames[category] || category;
		item.onclick = function() {
			filter.value = category;
			applyFilters();
			categoryList.querySelectorAll('.category-item').forEach(function(categoryItem) {
				categoryItem.classList.remove('is-selected');
			});
			item.classList.add('is-selected');
		};
		categoryList.appendChild(item);
	});
	document.getElementById('category-count').textContent = categoryKeys.length;
	filter.onchange = applyFilters;
	document.getElementById('channel-search').oninput = applyFilters;
}

function startPlayer() {
	if (playerStarted) return;
	playerStarted = true;
	renderCategories();
	channelList = allChannels.slice();
	renderChannelList();
	sPlayer.init();
}

function loadChannelsAndStart(isRefresh) {
	var refreshButton = document.getElementById('refresh-channels');
	if (!window.fetch) {
		if (!playerStarted) {
			allChannels = fallbackChannelList;
			startPlayer();
		}
		updateSyncStatus('Live list unavailable', true);
		return;
	}
	if (refreshInProgress) return;
	refreshInProgress = true;
	if (refreshButton) refreshButton.disabled = true;
	updateSyncStatus(isRefresh ? 'Refreshing…' : 'Syncing…', false);
	fetchChannelData().then(function(results) {
		applyChannelData(results);
		if (!playerStarted) startPlayer();
		updateSyncStatus('Last sync: ' + new Date().toLocaleTimeString(), false);
	}).catch(function(error) {
		console.error(error);
		if (!playerStarted) {
			allChannels = fallbackChannelList;
			startPlayer();
		}
		updateSyncStatus(isRefresh ? 'Refresh failed' : 'Sync failed', true);
	}).then(function() {
		refreshInProgress = false;
		if (refreshButton) refreshButton.disabled = false;
	});
}

var onShowEvent = function() {
	if (isSamsung) {
		var nnaviPlugin = document.getElementById('pluginObjectNNavi');
		if (nnaviPlugin && nnaviPlugin.SetBannerState) nnaviPlugin.SetBannerState(1);
		pluginAPI.unregistKey(tvKey.KEY_VOL_UP);
		pluginAPI.unregistKey(tvKey.KEY_VOL_DOWN);
		pluginAPI.unregistKey(tvKey.KEY_MUTE);
	}
	loadChannelsAndStart();
};

Main.onUnload = function() { if (typeof sPlayer !== 'undefined') sPlayer.stop(); };
Main.enableKeys = function() { document.getElementById('anchor').focus(); };
Main.keyDown = function(event) {
	var keyCode = event ? event.keyCode : window.event.keyCode;
	if (!isSamsung) { if (keyCode === 38) sPlayer.channelUp(); if (keyCode === 40) sPlayer.channelDown(); return; }
	switch (keyCode) {
		case tvKey.KEY_RETURN: case tvKey.KEY_PANEL_RETURN: widgetAPI.sendReturnEvent(); break;
		case tvKey.KEY_CH_UP: sPlayer.channelUp(); break;
		case tvKey.KEY_CH_DOWN: sPlayer.channelDown(); break;
		case tvKey.KEY_0: case tvKey.KEY_1: case tvKey.KEY_2: case tvKey.KEY_3:
		case tvKey.KEY_4: case tvKey.KEY_5: case tvKey.KEY_6: case tvKey.KEY_7:
		case tvKey.KEY_8: case tvKey.KEY_9: sPlayer.gotoChannel(keyCode - tvKey.KEY_0); break;
	}
};
