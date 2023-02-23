// ==UserScript==
// @name        C.A.S (Chess.com Assistance System)
// @namespace   sayfpack
// @author      sayfpack
// @version     4.2
// @homepageURL https://github.com/sayfpack13/chess-analysis-bot
// @supportURL  https://mmgc.life/
// @match       https://www.chess.com/*
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_getResourceText
// @grant       GM_registerMenuCommand
// @description Chess analysis bot made for educational purposes only (Chrome + Firefox + Edge ...)
// @require     https://greasyfork.org/scripts/460400-usergui-js/code/userguijs.js?version=1152084
// @resource    jquery.js       https://cdn.jsdelivr.net/npm/jquery@3.6.3/dist/jquery.min.js
// @resource    chessboard.js   https://raw.githubusercontent.com/sayfpack13/chess-analysis-bot/main/tampermonkey%20script/content/chessboard.js
// @resource    chessboard.css  https://raw.githubusercontent.com/sayfpack13/chess-analysis-bot/main/tampermonkey%20script/content/chessboard.css
// @resource    lozza.js        https://raw.githubusercontent.com/sayfpack13/chess-analysis-bot/main/tampermonkey%20script/content/lozza.js
// @resource    stockfish.js    https://github.com/exoticorn/stockfish-js/releases/download/sf_5_js/stockfish.js
// @resource    stockfish2.js   https://github.com/lichess-org/stockfish.js/releases/download/ddugovic-250718/stockfish.js
// @run-at      document-start
// @inject-into content
// ==/UserScript==

/*
  e88~-_            e           ,d88~~\
 d888   \          d8b          8888
 8888             /Y88b         `Y88b
 8888            /  Y88b         `Y88b,
 Y888   / d88b  /____Y88b  d88b    8888
  "88_-~  Y88P /      Y88b Y88P \__88P'
*/

// VARS
const repositoryRawURL = 'https://raw.githubusercontent.com/sayfpack13/chess-analysis-bot/main/tampermonkey%20script';
const LICHESS_API = "https://lichess.org/api/cloud-eval";

const MAX_DEPTH = 20;
const MIN_DEPTH = 1;
const MAX_MOVETIME = 1500;
const MIN_MOVETIME = 50;
const MAX_ELO = 3000;
const DEPTH_MODE = 0;
const MOVETIME_MODE = 1;



let engineMode = 0;                                         // engine mode (0:depth / 1:movetime)
let engineIndex = 0;                                        // engine index (lozza => 0, stockfish => 1...)
let reload_every = 10;                                      // reload engine after x moves
let enableUserLog = true;                                   // enable engine log
let displayMovesOnSite = false;                             // display moves on chess board
let show_opposite_moves = false;                            // show opponent best moves if available
let use_book_moves = false;                                 // use lichess api to get book moves
let node_engine_url = "http://localhost:5000";    // node server api url
let node_engine_name = "stockfish-15.exe"                        // default engine name (node server engine only)



let current_depth = Math.round(MAX_DEPTH / 2);
let current_movetime = Math.round(MAX_MOVETIME / 2);
let node_engine_id = [3];

let Gui;
let closedGui = false;
let reload_count = 1;

const rank = ["Beginner", "Intermediate", "Advanced", "Expert", "Master"];

const dbValues = {
    openGuiAutomatically: 'openGuiAutomatically',
    subtleMode: 'subtleMode',
    subtletiness: 'subtletiness'
};




let Interface = null;
let LozzaUtils = null;

let initialized = false;
let firstMoveMade = false;


let engine = null;
let engineObjectURL = null;
let lastEngine = engineIndex;

let chessBoardElem = null;
let turn = '-';
let playerColor = null;
let lastFen = null;

let uiChessBoard = null;

let activeGuiMoveHighlights = [];
let activeSiteMoveHighlights = [];

let engineLogNum = 1;
let userscriptLogNum = 1;
let enemyScore = 0;
let myScore = 0;


function moveResult(givenFen = "", from, to, power, clear = true) {
    // make sure both fens are equal
    // because engine requests/results are async
    const FenUtil = new FenUtils();
    let fen = FenUtil.getFen();
    if (givenFen != "" && givenFen != fen) {
        return;
    }

    if (from.length < 2 || to.length < 2) {
        return;
    }

    if (clear) {
        removeSiteMoveMarkings();
        Interface.boardUtils.removeBestMarkings();
    }

    const isPlayerTurn = playerColor == turn;


    if (isPlayerTurn) // my turn
        myScore = myScore + Number(power);
    else
        enemyScore = enemyScore + Number(power);

    Interface.boardUtils.updateBoardPower(myScore, enemyScore);

    if (displayMovesOnSite) {
        markMoveToSite(from, to, isPlayerTurn, clear);
    }



    Interface.boardUtils.markMove(from, to, isPlayerTurn, clear);
    Interface.stopBestMoveProcessingAnimation();


}


function getBookMoves(fen, lichess, turn) {
    GM_xmlhttpRequest({
        method: "GET",
        url: LICHESS_API + "?fen=" + fen + "&multiPv=3&variant=fromPosition",
        headers: {
            "Content-Type": "application/json"
        },
        onload: function (response) {
            if (response.response.includes("error")) {

                getBestMoves(fen, lichess, turn);

            } else {
                let data = JSON.parse(response.response);
                let nextMove = data.pvs[0].moves.split(' ')[0];
                let score = current_depth;


                moveResult(fen, nextMove.slice(0, 2), nextMove.slice(2, 4), score, true);
            }


        }, onerror: function (error) {
            getBestMoves(fen, lichess, turn);

        }
    });

}

function getNodeBestMoves(fen, lichess, turn) {


    GM_xmlhttpRequest({
        method: "GET",
        url: node_engine_url + "/getBestMove?fen=" + fen + "&engine_mode=" + engineMode + "&depth=" + current_depth + "&movetime=" + current_movetime + "&turn=" + turn + "&lichess=" + lichess + "&engine_name=" + node_engine_name,
        headers: {
            "Content-Type": "application/json"
        },
        onload: function (response) {
            if (response.response == "false") {
                return;
            }
            let data = JSON.parse(response.response);
            let fen = data.fen;
            let depth = data.depth;
            let movetime = data.movetime;
            let power = data.score;
            let nextMove = data.move;
            let oppositeMove = data.opposite_move;


            if (engineMode == DEPTH_MODE) {
                Interface.updateBestMoveProgress(`Depth: ${depth}`);
            } else {
                Interface.updateBestMoveProgress(`Move time: ${movetime} ms`);
            }



            moveResult(fen, nextMove.slice(0, 2), nextMove.slice(2, 4), power, true);
            if (oppositeMove != "false" && show_opposite_moves)
                moveResult(fen, oppositeMove.slice(0, 2), oppositeMove.slice(2, 4), power, false);



        }, onerror: function (error) {
            console.log("check node server !!");

        }
    });

}

function getElo() {
    let elo;
    if (engineMode == DEPTH_MODE) {
        elo = MAX_ELO / MAX_DEPTH;
        elo*=current_depth;
    } else {
        elo = MAX_ELO / MAX_MOVETIME;
        elo*=current_movetime;
    }
    return elo;
}

function getRank() {
    let part;
    if (engineMode == DEPTH_MODE) {
        part = current_depth / (MAX_DEPTH / rank.length);
    } else {
        part = current_movetime / (MAX_MOVETIME / rank.length);
    }
    part = Math.round(part);

    if (part >= rank.length) {
        part = rank.length - 1;
    }

    return rank[part];
}






function getEloDescription() {
    let desc=`Elo: ${getElo()}, Rank: ${getRank()}, `;
    if (engineMode == DEPTH_MODE) {
        desc+= `Depth: ${current_depth}`;
    } else {
        desc+= `Move Time: ${current_movetime} ms`;
    }
    return desc;
}

function isNotCompatibleBrowser() {
    return navigator.userAgent.toLowerCase().includes("firefox")
}

onload = function () {
    if (isNotCompatibleBrowser()) {
        Gui = new UserGui;
    }

}

if (!isNotCompatibleBrowser()) {
    Gui = new UserGui;
} else {
    onload();
}


Gui.settings.window.title = 'C.A.S';
Gui.settings.window.external = true;
Gui.settings.window.size.width = 500;
Gui.settings.gui.external.popup = false;
Gui.settings.gui.external.style += GM_getResourceText('chessboard.css');
Gui.settings.gui.external.style += `
div[class^='board'] {
    background-color: black;
}
.best-move-from {
    background-color: #31ff7f;
    transform: scale(0.85);
}
.best-move-to {
    background-color: #31ff7f;
}
.negative-best-move-from {
    background-color: #fd0000;
    transform: scale(0.85);
}
.negative-best-move-to {
    background-color: #fd0000;
}
body {
    display: block;
    margin-left: auto;
    margin-right: auto;
    width: 360px;
}
#fen {
    margin-left: 10px;
}
#engine-log-container {
    max-height: 35vh;
    overflow: auto!important;
}
#userscript-log-container {
    max-height: 35vh;
    overflow: auto!important;
}
.sideways-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.rendered-form .card {
    margin-bottom: 10px;
}
.hidden {
    display: none;
}
.main-title-bar {
    display: flex;
    justify-content: space-between;
}
@keyframes wiggle {
    0% { transform: scale(1); }
   80% { transform: scale(1); }
   85% { transform: scale(1.1); }
   95% { transform: scale(1); }
  100% { transform: scale(1); }
}

.wiggle {
  display: inline-block;
  animation: wiggle 1s infinite;
}
`;

function FenUtils() {
    this.board = [
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
    ];

    this.pieceCodeToFen = pieceStr => {
        const [pieceColor, pieceName] = pieceStr.split('');

        return pieceColor == 'w' ? pieceName.toUpperCase() : pieceName.toLowerCase();
    }

    this.getFenCodeFromPieceElem = pieceElem => {
        return this.pieceCodeToFen([...pieceElem.classList].find(x => x.match(/^(b|w)[prnbqk]{1}$/)));
    }

    this.getPieceColor = pieceFenStr => {
        return pieceFenStr == pieceFenStr.toUpperCase() ? 'w' : 'b';
    }

    this.getPieceOppositeColor = pieceFenStr => {
        return this.getPieceColor(pieceFenStr) == 'w' ? 'b' : 'w';
    }

    this.squeezeEmptySquares = fenStr => {
        return fenStr.replace(/11111111/g, '8')
            .replace(/1111111/g, '7')
            .replace(/111111/g, '6')
            .replace(/11111/g, '5')
            .replace(/1111/g, '4')
            .replace(/111/g, '3')
            .replace(/11/g, '2');
    }

    this.posToIndex = pos => {
        const [x, y] = pos.split('');

        return { 'y': 8 - y, 'x': 'abcdefgh'.indexOf(x) };
    }

    this.getBoardPiece = pos => {
        const indexObj = this.posToIndex(pos);

        return this.board[indexObj.y][indexObj.x];
    }

    this.getRights = () => {
        let rights = '';

        // check for white
        const e1 = this.getBoardPiece('e1'),
            h1 = this.getBoardPiece('h1'),
            a1 = this.getBoardPiece('a1');

        if (e1 == 'K' && h1 == 'R') rights += 'K';
        if (e1 == 'K' && a1 == 'R') rights += 'Q';

        //check for black
        const e8 = this.getBoardPiece('e8'),
            h8 = this.getBoardPiece('h8'),
            a8 = this.getBoardPiece('a8');

        if (e8 == 'k' && h8 == 'r') rights += 'k';
        if (e8 == 'k' && a8 == 'r') rights += 'q';

        return rights ? rights : '-';
    }



    this.getBasicFen = () => {
        const pieceElems = [...chessBoardElem.querySelectorAll('.piece')];

        pieceElems.forEach(pieceElem => {
            const pieceFenCode = this.getFenCodeFromPieceElem(pieceElem);
            const [xPos, yPos] = pieceElem.classList.toString().match(/square-(\d)(\d)/).slice(1);

            this.board[8 - yPos][xPos - 1] = pieceFenCode;
        });

        const basicFen = this.squeezeEmptySquares(this.board.map(x => x.join('')).join('/'));

        return basicFen;
    }

    this.getFen = () => {
        const basicFen = this.getBasicFen();
        const rights = this.getRights();


        return `${basicFen} ${turn} ${rights} - 0 1`;
    }
}

function InterfaceUtils() {
    this.boardUtils = {
        findSquareElem: (squareCode) => {
            if (!Gui?.document) return;

            return Gui.document.querySelector(`.square-${squareCode}`);
        },
        markMove: (fromSquare, toSquare, isPlayerTurn, clear = true) => {
            if (!Gui?.document) return;

            const [fromElem, toElem] = [this.boardUtils.findSquareElem(fromSquare), this.boardUtils.findSquareElem(toSquare)];

            if (isPlayerTurn && clear) {
                fromElem.classList.add('best-move-from');
                toElem.classList.add('best-move-to');
            } else {
                fromElem.classList.add('negative-best-move-from');
                toElem.classList.add('negative-best-move-to');
            }

            activeGuiMoveHighlights.push(fromElem);
            activeGuiMoveHighlights.push(toElem);
        },
        removeBestMarkings: () => {
            if (!Gui?.document) return;

            activeGuiMoveHighlights.forEach(elem => {
                elem.classList.remove('best-move-from', 'best-move-to', 'negative-best-move-from', 'negative-best-move-to');
            });

            activeGuiMoveHighlights = [];
        },
        updateBoardFen: fen => {
            if (!Gui?.document) return;

            Gui.document.querySelector('#fen').textContent = fen;
        },
        updateBoardPower: (myScore, enemyScore) => {
            if (!Gui?.document) return;

            Gui.document.querySelector('#enemy-score').textContent = enemyScore;
            Gui.document.querySelector('#my-score').textContent = myScore;
        },
        updateBoardOrientation: orientation => {
            if (!Gui?.document) return;

            const orientationElem = Gui?.document?.querySelector('#orientation');

            if (orientationElem) {
                orientationElem.textContent = orientation;
            }
        }
    }

    this.engineLog = str => {
        if (!Gui?.document || enableUserLog == 0) return;

        const logElem = document.createElement('div');
        logElem.classList.add('list-group-item');

        if (str.includes('info')) logElem.classList.add('list-group-item-info');
        if (str.includes('bestmove')) logElem.classList.add('list-group-item-success');

        logElem.innerText = `#${engineLogNum++} ${str}`;

        Gui.document.querySelector('#engine-log-container').prepend(logElem);
    }

    this.log = str => {
        if (!Gui?.document || enableUserLog == 0) return;

        const logElem = document.createElement('div');
        logElem.classList.add('list-group-item');

        if (str.includes('info')) logElem.classList.add('list-group-item-info');
        if (str.includes('bestmove')) logElem.classList.add('list-group-item-success');

        const container = Gui?.document?.querySelector('#userscript-log-container');

        if (container) {
            logElem.innerText = `#${userscriptLogNum++} ${str}`;

            container.prepend(logElem);
        }
    }

    this.getBoardOrientation = () => {
        return document.querySelector('.board.flipped') ? 'b' : 'w';
    }

    this.updateBestMoveProgress = text => {
        if (!Gui?.document) return;

        const progressBarElem = Gui.document.querySelector('#best-move-progress');

        progressBarElem.innerText = text;

        progressBarElem.classList.remove('hidden');
        progressBarElem.classList.add('wiggle');
    }

    this.stopBestMoveProcessingAnimation = () => {
        if (!Gui?.document) return;

        const progressBarElem = Gui.document.querySelector('#best-move-progress');

        progressBarElem.classList.remove('wiggle');
    }

    this.hideBestMoveProgress = () => {
        if (!Gui?.document) return;

        const progressBarElem = Gui.document.querySelector('#best-move-progress');

        if (!progressBarElem.classList.contains('hidden')) {
            progressBarElem.classList.add('hidden');
            this.stopBestMoveProcessingAnimation();
        }
    }
}

function LozzaUtility() {
    this.separateMoveCodes = moveCode => {
        moveCode = moveCode.trim();

        let move = moveCode.split(' ')[1];

        return [move.slice(0, 2), move.slice(2, 4)];
    }

    this.extractInfo = str => {
        const keys = ['time', 'nps', 'depth'];

        return keys.reduce((acc, key) => {
            const match = str.match(`${key} (\\d+)`);

            if (match) {
                acc[key] = Number(match[1]);
            }

            return acc;
        }, {});
    }
}

function fenSquareToChessComSquare(fenSquareCode) {
    const [x, y] = fenSquareCode.split('');

    return `square-${['abcdefgh'.indexOf(x) + 1]}${y}`;
}

function markMoveToSite(fromSquare, toSquare, isPlayerTurn, clear) {
    const highlight = (fenSquareCode, style) => {
        const squareClass = fenSquareToChessComSquare(fenSquareCode);

        const highlightElem = document.createElement('div');
        highlightElem.classList.add('highlight');
        highlightElem.classList.add(squareClass);
        highlightElem.dataset.testElement = 'highlight';
        highlightElem.style = style;

        activeSiteMoveHighlights.push(highlightElem);

        const existingHighLight = document.querySelector(`.highlight.${squareClass}`);

        if (existingHighLight) {
            existingHighLight.remove();
        }

        chessBoardElem.prepend(highlightElem);
    }

    const defaultFromSquareStyle = 'background-color: rgb(249 121 255 / 90%); border: 4px solid rgb(0 0 0 / 50%);';
    const defaultToSquareStyle = 'background-color: rgb(129 129 129 / 90%); border: 4px dashed rgb(0 0 0 / 50%);';
    const negativeFromSquareStyle = 'background-color: rgb(255 0 0 / 20%); border: 4px solid rgb(0 0 0 / 50%);';
    const negativeToSquareStyle = 'background-color: rgb(255 0 0 / 20%); border: 4px dashed rgb(0 0 0 / 50%);';

    const subtleMode = GM_getValue(dbValues.subtleMode);
    const subtletiness = GM_getValue(dbValues.subtletiness);

    highlight(fromSquare, subtleMode ? `background-color: rgb(0 0 0 / ${subtletiness}%);` : (clear ? defaultFromSquareStyle : negativeFromSquareStyle));
    highlight(toSquare, subtleMode ? `background-color: rgb(0 0 0 / ${subtletiness}%);` : (clear ? defaultToSquareStyle : negativeToSquareStyle));
}

function removeSiteMoveMarkings() {
    activeSiteMoveHighlights.forEach(elem => {
        elem?.remove();
    });

    activeSiteMoveHighlights = [];
}

function updateBestMove(forced = false, mutationArr) {


    const FenUtil = new FenUtils();

    let currentFen = FenUtil.getFen();


    if (currentFen != lastFen || forced == true) {
        lastFen = currentFen;



        if (mutationArr) {
            const attributeMutationArr = mutationArr.filter(m => m.target.classList.contains('piece') && m.attributeName == 'class');

            if (attributeMutationArr?.length) {
                turn = FenUtil.getPieceOppositeColor(FenUtil.getFenCodeFromPieceElem(attributeMutationArr[0].target));
                Interface.log(`Turn updated to ${turn}!`);


                Interface.stopBestMoveProcessingAnimation();

                currentFen = FenUtil.getFen();

                Interface.boardUtils.removeBestMarkings();

                removeSiteMoveMarkings();

                Interface.boardUtils.updateBoardFen(currentFen);

                reloadChessEngine(false, () => {



                    // send engine only when it's my turn
                    if (playerColor == null || turn == playerColor || forced == true) {
                        Interface.log('Sending best move request to the engine!');



                        if (use_book_moves) {
                            getBookMoves(currentFen, false, turn);
                        } else {
                            getBestMoves(currentFen, false, turn);
                        }

                    }

                });
            }
        }








    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getBestMoves(fen, lichess, turn) {
    if (!node_engine_id.includes(engineIndex)) {
        // local engines
        while (!engine) {
            sleep(100);
        }
        engine.postMessage(`position fen ${fen}`);

        if (engineMode == DEPTH_MODE) {
            engine.postMessage('go depth ' + current_depth);
        } else {
            engine.postMessage('go movetime ' + current_movetime);
        }


    } else {
        // node server
        console.log("using node server");



        getNodeBestMoves(fen, lichess, turn);
    }
}

function observeNewMoves() {
    updateBestMove();

    const boardObserver = new MutationObserver(mutationArr => {
        const lastPlayerColor = playerColor;

        updatePlayerColor();


        if (playerColor != lastPlayerColor) {
            Interface.log(`Player color changed from ${lastPlayerColor} to ${playerColor}!`);

            updateBestMove();
        } else {
            updateBestMove(false, mutationArr);
        }
    });

    boardObserver.observe(chessBoardElem, { childList: true, subtree: true, attributes: true });
}

function addGuiPages() {
    if (Gui?.document) return;

    Gui.addPage("Main", `
    <div class="rendered-form" id="main-tab">
        <script>${GM_getResourceText('jquery.js')}</script>
        <script>${GM_getResourceText('chessboard.js')}</script>
        <div class="card">
            <div class="card-body" id="chessboard">
                <div class="main-title-bar">
                    <h4 class="card-title">Live Chessboard:</h4>
                    <p id="best-move-progress"></p>
                </div>

                <div id="board" style="width: 447px"></div>
            </div>
            <div id="orientation" class="hidden"></div>
            <div class="card-footer card"><input type="button" value="Get Best Move" id="bestmove-btn"></input></div>
            <div class="card-footer sideways-card">FEN :<small class="text-muted"><div id="fen"></div></small></div>
            <div class="card-footer sideways-card">ENEMY SCORE :<div id="enemy-score"></div></div>
            <div class="card-footer sideways-card">MY SCORE : <div id="my-score"></div></div>
        </div>
        <script>
        const orientationElem = document.querySelector('#orientation');
        const fenElem = document.querySelector('#fen');

        let board = ChessBoard('board', {
            pieceTheme: '${repositoryRawURL}/content/chesspieces/{piece}.svg',
            position: 'start',
            orientation: '${playerColor == 'b' ? 'black' : 'white'}'
        });

        const orientationObserver = new MutationObserver(() => {
            board = ChessBoard('board', {
                pieceTheme: '${repositoryRawURL}/content/chesspieces/{piece}.svg',
                position: fenElem.textContent,
                orientation: orientationElem.textContent == 'b' ? 'black' : 'white'
            });
        });

        const fenObserver = new MutationObserver(() => {
            board.position(fenElem.textContent);
        });

        orientationObserver.observe(orientationElem, { attributes: true,  childList: true,  characterData: true });
        fenObserver.observe(fenElem, { attributes: true,  childList: true,  characterData: true });
        </script>
    </div>
    `);

    Gui.addPage('Log', `
    <div class="rendered-form" id="log-tab">
        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Userscript Log:</h4>
                <ul class="list-group" id="userscript-log-container"></ul>
            </div>
        </div>
        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Engine Log</h4>
                <ul class="list-group" id="engine-log-container"></ul>
            </div>
        </div>
    </div>
    `);


    const subtletiness = GM_getValue(dbValues.subtletiness);


    const openGuiAutomatically = GM_getValue(dbValues.openGuiAutomatically) == true;
    const subtleMode = GM_getValue(dbValues.subtleMode) == true;





    Gui.addPage('Settings', `
    <div class="rendered-form" id="settings-tab">
        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Engine:</h4>
                <div class="form-group field-select-engine">
                    <select class="form-control" name="select-engine" id="select-engine">
                        <option value="option-lozza" id="select-engine-0">Lozza</option>
                        <option value="option-stockfish" id="select-engine-2">Stockfish 5</option>
                        <option value="option-stockfish2" id="select-engine-3">Stockfish 2018</option>
                        <option value="option-nodeserver" id="select-engine-4">Node Server Engines</option>
                    </select>
                </div>


				
				<div id="node-engine-div" style="display:${(node_engine_id.includes(engineIndex)) ? 'block' : 'none'};">
                    <label for="engine-url">Engine URL:</label>
                    <input type="text" id="engine-url" value="${node_engine_url}">
                    <br>
					<label for="engine-name">Engine Name:</label>
					<input type="text" id="engine-name" value="${node_engine_name}">
				</div>
            </div>
        </div>


        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Engine Strength:</h4>

			<h7 class="card-title">Engine Mode:</h7>
            <div class="form-group field-select-engine-mode">
			
                <select class="form-control" name="select-engine-mode" id="select-engine-mode">
                    <option value="option-depth" id="select-engine-mode-0">Depth</option>
                    <option value="option-movetime" id="select-engine-mode-1">Move time</option>
                </select>
            </div>
			
            <h7 class="card-title">Engine Power:</h7>
                <input type="range" class="form-range" min="${MIN_DEPTH}" max="${MAX_DEPTH}" step="1" value="${current_depth}" id="depth-range">
                <input type="number" class="form-range" min="${MIN_DEPTH}" max="${MAX_DEPTH}" value="${current_depth}" id="depth-range-number">
                <input type="range" class="form-range" min="${MIN_MOVETIME}" max="${MAX_MOVETIME}" step="50" value="${current_movetime}" id="movetime-range">
                <input type="number" class="form-range" min="${MIN_MOVETIME}" max="${MAX_MOVETIME}" value="${current_movetime}" id="movetime-range-number">
			</div>
            <div class="card-footer sideways-card" id="elo">${getEloDescription()}</div>
        </div>

        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Other:</h4>

				        <div>
                            <input type="checkbox" id="enable-user-log" ${enableUserLog ? 'checked' : ''}>
                            <label for="enable-user-log">Enable User Scripts Log</label>
                        </div>


                        <div>
                            <input type="checkbox" id="use-book-moves" ${use_book_moves ? 'checked' : ''}>
                            <label for="use-book-moves">Use book moves</label>
                        </div>



						<div id="reload-count-div" style="display:${node_engine_id.includes(engineIndex) ? 'none' : 'block'};">
                            <label for="reload-count">Reload Engine every</label>
                            <input type="number" id="reload-count" value="${reload_every}">
							<label for="reload-count"> moves</label>
                        </div>
        </div>


        <div class="card">
            <div class="card-body">
                <h4 class="card-title">Visual:</h4>
                <div id="display-moves-on-site-warning" class="alert alert-danger">
                    <strong>Warning !!</strong> You can get Permanently banned in 24 hours. Use with caution.
                </div>

            <div>
                <input type="checkbox" id="show-opposite-moves" ${show_opposite_moves ? 'checked' : ''}>
                <label for="show-opposite-moves">Show Opponent best moves</label>
            </div>


                <input type="checkbox" id="display-moves-on-site" ${displayMovesOnSite ? 'checked' : ''}>
                <label for="display-moves-on-site">Display moves on site</label>
                <!-- Display moves on site additional settings -->
                <div class="card ${displayMovesOnSite ? '' : 'hidden'}" id="display-moves-on-site-additional">
                    <div class="card-body">
                        <!-- Open GUI automatically checkbox -->
                        <div>
                            <input type="checkbox" id="open-gui-automatically" ${openGuiAutomatically ? 'checked' : ''}>
                            <label for="open-gui-automatically">Open GUI automatically</label>
                        </div>
                        <!-- Subtle mode settinngs -->
                        <div>
                            <!-- Subtle mode checkbox -->
                            <div>
                                <input type="checkbox" id="subtle-mode" ${subtleMode ? 'checked' : ''}>
                                <label for="subtle-mode">Subtle mode</label>
                            </div>
                            <!-- Subtle mode additional settings -->
                            <div>
                                <div class="card ${subtleMode ? '' : 'hidden'}" id="subtletiness-range-container">
                                    <div class="card-body">
                                        <!-- Subtletiness range -->
                                        <h6 class="card-title">Visibility</h6>
                                        <input type="range" class="form-range" min="1" max="50" value="${subtletiness}" id="subtletiness-range">
                                    </div>
                                    <div class="card-footer sideways-card">Percentage <small id="subtletiness-info">${subtletiness}%</small></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `);


}

function fixDepthMoveTimeInput(depthRangeElem, depthRangeNumberElem, moveTimeRangeElem, moveTimeRangeNumberElem, eloElem) {
    if (engineMode == DEPTH_MODE) {
        if (isNotCompatibleBrowser()) {
            depthRangeElem.style.display = "none";
            depthRangeNumberElem.style.display = "block";
            moveTimeRangeElem.style.display = "none";
            moveTimeRangeNumberElem.style.display = "none";
        } else {
            depthRangeElem.style.display = "block";
            depthRangeNumberElem.style.display = "none";
            moveTimeRangeElem.style.display = "none";
            moveTimeRangeNumberElem.style.display = "none";
        }
    } else {
        if (isNotCompatibleBrowser()) {
            depthRangeElem.style.display = "none";
            depthRangeNumberElem.style.display = "none";
            moveTimeRangeElem.style.display = "none";
            moveTimeRangeNumberElem.style.display = "block";
        } else {
            depthRangeElem.style.display = "none";
            depthRangeNumberElem.style.display = "none";
            moveTimeRangeElem.style.display = "block";
            moveTimeRangeNumberElem.style.display = "none";
        }
    }


    eloElem.innerText = getEloDescription();

}

function openGUI() {
    Interface.log(`Opening GUI!`);

    const hide = elem => elem.classList.add('hidden');
    const show = elem => elem.classList.remove('hidden');

    Gui.open(() => {
        const depthRangeElem = Gui.document.querySelector('#depth-range');
        const depthRangeNumberElem = Gui.document.querySelector('#depth-range-number');
        const moveTimeRangeElem = Gui.document.querySelector('#movetime-range');
        const moveTimeRangeNumberElem = Gui.document.querySelector('#movetime-range-number');
        const engineModeElem = Gui.document.querySelector('#select-engine-mode');
        const engineElem = Gui.document.querySelector('#select-engine');
        const engineNameDivElem = Gui.document.querySelector('#node-engine-div');
        const reloadEveryDivElem = Gui.document.querySelector('#reload-count-div');
        const nodeEngineNameElem = Gui.document.querySelector('#engine-name');
        const nodeEngineUrlElem = Gui.document.querySelector('#engine-url');
        const useLocalEngineElem = Gui.document.querySelector('#use-book-moves');
        const showOppositeMovesElem = Gui.document.querySelector('#show-opposite-moves');
        const displayMovesOnSiteElem = Gui.document.querySelector('#display-moves-on-site');
        const openGuiAutomaticallyElem = Gui.document.querySelector('#open-gui-automatically');
        const openGuiAutomaticallyAdditionalElem = Gui.document.querySelector('#display-moves-on-site-additional');
        const subtleModeElem = Gui.document.querySelector('#subtle-mode');
        const subtletinessRangeContainerElem = Gui.document.querySelector('#subtletiness-range-container');
        const subtletinessRange = Gui.document.querySelector('#subtletiness-range');
        const subtletinessInfo = Gui.document.querySelector('#subtletiness-info');
        const reloadEveryElem = Gui.document.querySelector('#reload-count');
        const enableUserLogElem = Gui.document.querySelector('#enable-user-log');
        const eloElem = Gui.document.querySelector('#elo');
        const getBestMoveElem = Gui.document.querySelector('#bestmove-btn');


        fixDepthMoveTimeInput(depthRangeElem, depthRangeNumberElem, moveTimeRangeElem, moveTimeRangeNumberElem, eloElem);

        engineElem.selectedIndex = engineIndex;
        engineModeElem.selectedIndex = engineMode;


        // compatibility fixed
        if (isNotCompatibleBrowser()) {
            Gui.document.querySelector('#content').style.maxHeight = "500px";
            Gui.document.querySelector('#content').style.overflow = "scroll";
            Gui.document.querySelector('#chessboard').style.display = "none";
            Gui.document.querySelector('#orientation').style.display = "none";
            Gui.document.querySelector('#engine-log-container').style.maxHeight = "100px";
            Gui.document.querySelector('#engine-log-container').style.overflow = "scroll";
            Gui.document.querySelector('#userscript-log-container').style.maxHeight = "100px";
            Gui.document.querySelector('#userscript-log-container').style.overflow = "scroll";

            Gui.document.querySelector('#button-close-gui').addEventListener('click', e => {
                e.preventDefault();
                if (closedGui == true) {
                    closedGui = false;
                    Gui.document.querySelector("#content").style.display = "block";
                }
                else {
                    closedGui = true;
                    Gui.document.querySelector("#content").style.display = "none";

                }


            });
        }

        getBestMoveElem.onclick = () => {
            updateBestMove(true);
        }

        engineModeElem.onchange = () => {
            engineMode = engineModeElem.selectedIndex;

            fixDepthMoveTimeInput(depthRangeElem, depthRangeNumberElem, moveTimeRangeElem, moveTimeRangeNumberElem, eloElem);
        }
        nodeEngineNameElem.onchange = () => {
            node_engine_name = nodeEngineNameElem.value;
        }
        nodeEngineUrlElem.onchange = () => {
            node_engine_url = nodeEngineUrlElem.value;
        }

        enableUserLogElem.onchange = () => {
            const isChecked = enableUserLogElem.checked;

            if (isChecked)
                enableUserLog = true;
            else
                enableUserLog = false;
        }

        reloadEveryElem.onchange = () => {
            reload_every = reloadEveryElem.value;
        }

        engineElem.onchange = () => {
            lastEngine = engineIndex;
            engineIndex = engineElem.selectedIndex;



            if (node_engine_id.includes(engineIndex)) {
                reloadEveryDivElem.style.display = "none";
                engineNameDivElem.style.display = "block";


            }
            else {
                reloadEveryDivElem.style.display = "block";
                engineNameDivElem.style.display = "none";
            }





            if (engineObjectURL) {
                URL.revokeObjectURL(engineObjectURL);
                engineObjectURL = null;
            }




            reloadChessEngine(true, () => {
                Interface.boardUtils.removeBestMarkings();

                removeSiteMoveMarkings();

                Interface.boardUtils.updateBoardPower(0, 0);
            });

        }



        depthRangeElem.onchange = () => {
            changeEnginePower(depthRangeElem.value, eloElem);
        };

        depthRangeNumberElem.onchange = () => {
            changeEnginePower(depthRangeNumberElem.value, eloElem);
        };

        moveTimeRangeElem.onchange = () => {
            changeEnginePower(moveTimeRangeElem.value, eloElem);
        };

        moveTimeRangeNumberElem.onchange = () => {
            changeEnginePower(moveTimeRangeNumberElem.value, eloElem);
        };

        showOppositeMovesElem.onchange = () => {
            const isChecked = showOppositeMovesElem.checked;

            if (isChecked) {
                show_opposite_moves = true;
            } else {
                show_opposite_moves = false;
            }
        }

        useLocalEngineElem.onchange = () => {
            const isChecked = useLocalEngineElem.checked;

            if (isChecked) {
                use_book_moves = true;
            } else {
                use_book_moves = false;
            }
        }

        displayMovesOnSiteElem.onchange = () => {
            const isChecked = displayMovesOnSiteElem.checked;

            if (isChecked) {
                displayMovesOnSite = true;

                show(openGuiAutomaticallyAdditionalElem);

                openGuiAutomaticallyElem.checked = GM_getValue(dbValues.openGuiAutomatically);
            } else {
                displayMovesOnSite = false;
                GM_setValue(dbValues.openGuiAutomatically, true);

                hide(openGuiAutomaticallyAdditionalElem);
            }
        };

        openGuiAutomaticallyElem.onchange = () => {
            GM_setValue(dbValues.openGuiAutomatically, openGuiAutomaticallyElem.checked);
        };

        subtleModeElem.onchange = () => {
            const isChecked = subtleModeElem.checked;

            if (isChecked) {
                GM_setValue(dbValues.subtleMode, true);
                show(subtletinessRangeContainerElem);
            } else {
                GM_setValue(dbValues.subtleMode, false);
                hide(subtletinessRangeContainerElem);
            }
        };

        subtletinessRange.onchange = () => {
            GM_setValue(dbValues.subtletiness, subtletinessRange.value);
            subtletinessInfo.innerText = `${subtletinessRange.value}%`;
        };

        window.onunload = () => {
            if (Gui.window && !Gui.window.closed) {
                Gui.window.close();
            }
        };

        const isWindowClosed = setInterval(() => {
            if (Gui.window.closed) {
                clearInterval(isWindowClosed);
                if (engine != null)
                    engine.terminate();
            }
        }, 1000);

        observeNewMoves();

        Interface.log('Initialized!');
    });
}

function changeEnginePower(val, eloElem) {
    if (engineMode == DEPTH_MODE) {
        current_depth = val
    } else {
        current_movetime = val
    }


    eloElem.innerText = getEloDescription();
}

function reloadChessEngine(forced, callback) {
    // reload only if using local engines
    if (node_engine_id.includes(engineIndex) && forced == false)
        callback();
    else if (reload_count >= reload_every || forced == true) {
        reload_count = 1;
        Interface.log(`Reloading the chess engine!`);

        if (engine)
            engine.terminate();

        loadChessEngine(callback);
    }
    else {
        reload_count = reload_count + 1;
        callback();
    }
}



function loadChessEngine(callback) {
    if (!engineObjectURL) {
        if (engineIndex == 0)
            engineObjectURL = URL.createObjectURL(new Blob([GM_getResourceText('lozza.js')], { type: 'application/javascript' }));
        else if (engineIndex == 1)
            engineObjectURL = URL.createObjectURL(new Blob([GM_getResourceText('stockfish.js')], { type: 'application/javascript' }));
        else if (engineIndex == 2)
            engineObjectURL = URL.createObjectURL(new Blob([GM_getResourceText('stockfish2.js')], { type: 'application/javascript' }));
    }

    if (engineObjectURL) {
        engine = new Worker(engineObjectURL);

        engine.onmessage = e => {
            if (e.data.includes('bestmove')) {


                let move = e.data.split(' ')[1];
                let move2 = e.data.split(' ')[3];

                moveResult("", move.slice(0, 2), move.slice(2, 4), 0, true);
                if ((move2 != undefined || move2 != "") && show_opposite_moves) {
                    moveResult("", move2.slice(0, 2), move2.slice(2, 4), 0, false);
                }
            }

            else if (e.data.includes('info')) {

                const infoObj = LozzaUtils.extractInfo(e.data);

                if (engineMode == DEPTH_MODE) {

                    Interface.updateBestMoveProgress(`Depth: ${infoObj.depth}`);

                } else {

                    Interface.updateBestMoveProgress(`Move time: ${infoObj.time} ms`);

                }

            }
            Interface.engineLog(e.data);
        };

        engine.postMessage('ucinewgame');

        Interface.log(`Loaded the chess engine!`);
    }

    callback();
}

function initializeDatabase() {
    const initValue = (name, value) => {
        if (GM_getValue(name) == undefined) {
            GM_setValue(name, value);
        }
    };

    initValue(dbValues.subtleMode, false);
    initValue(dbValues.openGuiAutomatically, true);
    initValue(dbValues.subtletiness, 25);

    Interface.log(`Initialized the database!`);
}

async function updatePlayerColor() {
    const boardOrientation = Interface.getBoardOrientation();

    playerColor = boardOrientation;
    turn = boardOrientation;

    Interface.boardUtils.updateBoardOrientation(playerColor);
}

async function initialize(openInterface) {
    Interface = new InterfaceUtils();
    LozzaUtils = new LozzaUtility();

    const boardOrientation = Interface.getBoardOrientation();
    turn = boardOrientation;

    initializeDatabase();

    loadChessEngine(() => {

    });

    updatePlayerColor();

    if (openInterface) {
        addGuiPages();
        openGUI();
    } else {
        observeNewMoves();
    }
}

if (typeof GM_registerMenuCommand == 'function') {
    GM_registerMenuCommand("Open C.A.S", e => {
        if (chessBoardElem) {
            initialize(true);
        }
    }, 's');
}

const waitForChessBoard = setInterval(() => {
    const boardElem = document.querySelector('chess-board');
    const firstPieceElem = document.querySelector('.piece');

    if (boardElem && firstPieceElem && chessBoardElem != boardElem) {
        chessBoardElem = boardElem;

        if (window.location.href != 'https://www.chess.com/play') {
            const openGuiAutomatically = GM_getValue(dbValues.openGuiAutomatically);

            if (openGuiAutomatically == undefined) {
                initialize(true);
            } else {
                initialize(openGuiAutomatically);
            }
        }
    }
}, 1000);