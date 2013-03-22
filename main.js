
var child_process = require('child_process')
	, fs = require('fs')
		, http = require('http')
		, D = require('./D.js')
		, DEBUG_MODE = true
		, log = function(){
				if( typeof(DEBUG_MODE) !== 'undefined' && DEBUG_MODE ){
						return console.log.apply(console,arguments);
				}
		}
;

// promisify some node functions
var exec = D.nodeCapsule(child_process.exec)
		, readFile = D.nodeCapsule(fs.readFile)
		, readCachedFile = function(file){
				if (DEBUG_MODE) {
						return readFile(file);
				}
				var d=D();
				if (readCachedFile.cached && readCachedFile.cached[file]) {
						d.resolve(readCachedFile.cached[file]);
				} else {
						readFile(file).then(function(data){ d.resolve(readCachedFile.cached[file] = data);console.log(data)},d.reject).rethrow();
				}
				return d.promise;
		}
;

readCachedFile.cached = {};

//first read config file
var repoConfig=null
		, repoStatuses={}
		, staticCache={}
;

/**
* return a promise of updated config read
* @return promise
*/
function updateConfig(){
    var d=D();
    readFile('./repositories-config.json',{encoding:'utf8'})
        .then(function(data){ var tmp = JSON.parse(data.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g,'')); repoConfig = tmp; d.resolve(true);})
        .rethrow(function(err){d.reject(err);log(err);}) 
				.then(function(){console.log('LOG',arguments)})
    ;
    return d.promise;
}

/**
* parse branches part of the log and return a  list of branches as an array
* @param string log part containing the branches
* @param object repoConfig the configuration matching the repository
* @return Array
*/
function parseBranches(str,repoConfig){
    var res=[],exp=new RegExp("(?:Merge branch(?:es)?|,|and)\\s+?'([^']+)'\\s*(?=,|and |into "+repoConfig.testing+")",'g');
    str.replace(exp, function(m,branch){ res.push({name:branch});});
    log('\nPARSEBRANCHES:\n',str,exp,res,'\n');
    return res;
}
/**
* update a single repository status
* @param string repoName
* @param bool remoteUpdateFirst
* @return promise of object repoStatus
*/
function updateRepoStatus(repoName,remoteUpdateFirst){
    if( repoConfig === null ){ // enforce a config is already read
        return updateConfig().then(function(){ return updateRepoStatus(repoName,remoteUpdateFirst);});
    }
    var conf = repoConfig[repoName];
    if( undefined === conf ){
        throw 'invalid repoName '+repoName;
    }
    var cmd ='git log --merges '+conf.upstream+'/'+conf.prod+'..'+conf.upstream+'/'+conf.testing+' --pretty="%cn#%ci#%s"'
        ,cmdOpts = {cwd:conf.path}
        ,statusPromise
    ;
    if( remoteUpdateFirst ){
        statusPromise=exec('git remote update',cmdOpts).then(function(){ return exec(cmd,cmdOpts);});
    }else{
        statusPromise=exec(cmd,cmdOpts);
    }
    return statusPromise
        .apply(function(stdout,stderr){
            // initialize repoStatus[repoName]
            repoStatuses[repoName] = {label:repoConfig[repoName].label,merges:[]};
            log('\nSTART '+repoName+'\n',stdout,repoStatuses[repoName],'\n---------------------------\n');
            stdout.replace(/^([^#]+)#([^#]+)#([^\n]+)/mg,function(m,by,date,branches){
                //log('FEEDING '+repoName+'\n with:'+stdout+'\n',branches,'\n');
                repoStatuses[repoName].merges.push({
                    by:by
                    ,at:date
                    ,branches:parseBranches(branches,conf)
                });
            });
            repoStatuses[repoName].merges.sort(function(a,b){ return a.at > b.at ? -1 : (a.at===b.at?0:1);});
            return repoStatuses[repoName];
        })
        .rethrow(function(err){
            repoStatuses[repoName] = {label:repoConfig[repoName].label,error:err.toString()};
        })
    ;
}

/**
* update all repositories statuses
* @param bool remoteUpdateFirst
* @return promise of object repoStatuses
*/
function updateRepoStatuses(remoteUpdateFirst){
log('updating')
	var promises=[];
	for( var repo in repoConfig ){
        promises.push(updateRepoStatus(repo,remoteUpdateFirst));
	}
    return D.all(promises);
}

// starting the server
updateConfig()
		.then(function(){ updateRepoStatuses(true) })
		.then(function(){
				log('create server',repoConfig)
				http.createServer(function (req, res) {
					//res.writeHead(200, {'Content-Type': 'application/json'});
				log('requesting '+req.url,readCachedFile.cached);
					switch(req.url){
						case '/getStatuses':
								res.writeHead(200, {'Content-Type': 'application/json'});
								res.end(JSON.stringify(repoStatuses));
								break;
						case '/D.js':
								readCachedFile('./D.js')
										.success(function(data){
												res.writeHead(200, {"Content-Type":'application/javascript'});
												res.end(data, "binary");
										})
										.error(function(err){
												res.writeHead(500, {"Content-Type": "text/plain"});
												res.end(err + "\n");
										})
								;
								break;
						default:
								//first lookup for a matching static file
								if( req.url.match(/\/(|index(?:\.html)?|(?:basic-compat|stpl)\.js)$/) ){
										if( req.url === '/' || req.url === '/index' ){
												req.url = '/index.html';
										}
										readCachedFile('public'+req.url)
												.success(function(data){
														req.url.replace(/\.(js|css|html|htm)$/,function(m,ext){
																var ctype='text/html';
																(ext==='css') && (ctype='text/css');
																(ext==='js') && (ctype='application/javascript');
																res.setHeader("Content-Type",ctype);
														});
														res.writeHead(200);
														res.write(data, "binary");
														res.end();
												})
												.error(function(err){
														res.writeHead(500, {"Content-Type": "text/plain"});
														res.write(err + "\n");
														res.end();
												})
												.rethrow()
										;
										break;
								}
								//then trying to match dynamic pathes
								var params =  req.url.match(/^\/getStatus\/([^\/]+)$/);
								if( null===params ){
										console.log('404',req.url);
										res.writeHead(404, {'Content-Type': 'text/html'});
										res.end('<h1>404</h1> Page unknown');
										break;
								}
								console.log(req.url,params);
								updateRepoStatus(params[1],true)
										.then(function(status){
												res.writeHead(200, {'Content-Type': 'application/json'});
												res.end(JSON.stringify(status));
										})
								;
								break;
					}
				}).listen( process.argv[2] || 8000, '127.0.0.1');
				console.log('running',process.argv[2] || 8000);
		})
		.rethrow()
;
return ;
updateConfig()
    .then(updateRepoStatuses)
	.then(function(){
		console.log(JSON.stringify(repoStatuses));
	});
return;
