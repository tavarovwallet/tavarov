// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * TavarovPay v2 — приём оплаты с комиссией, бонусами TVR и возвратами.
 *
 * ЧТО ДОБАВИЛОСЬ ВО ВТОРОЙ ВЕРСИИ
 *
 *   Возврат денег покупателю — refund. В первой версии его не было, и
 *   продавцу оставался обычный перевод «на глазок»: магазин о таком
 *   возврате не узнавал, а бонусы за отменённую покупку оставались
 *   начисленными. Второе хуже первого: покупку можно было гонять по
 *   кругу и добывать TVR за один процент комиссии.
 *
 *   Теперь каждая оплата записывается под своим номером счёта, и возврат
 *   по этому номеру:
 *     - переводит деньги обратно покупателю;
 *     - отменяет бонусы обеих сторон соразмерно возвращённому;
 *     - оставляет след в сети, по которому магазин закрывает заказ сам.
 *
 *   Отменить можно только то, что ещё не забрано. Забранное назад не
 *   тянем: это чужие деньги на чужом кошельке, и лезть туда контракт не
 *   вправе. Поэтому созревание бонусов и стоит 90 дней — за это время
 *   любой возврат успевает случиться.
 *
 * ГЛАВНОЕ, ЧТО НАДО ПОНИМАТЬ ПРО ЭТОТ КОНТРАКТ:
 *
 * Деньги покупателя нигде не задерживаются. В одной операции они уходят
 * продавцу, а комиссия — в вашу казну. Контракт не хранит выручку продавцов
 * ни секунды, и функции «забрать чужое» в нём нет. Даже владелец контракта
 * не может остановить платёж или присвоить чужие средства.
 *
 * Поэтому кошелёк остаётся некастодиальным: вы не посредник, через которого
 * идут чужие деньги, вы автор программы, которая делит платёж по правилам,
 * записанным в блокчейне и видимым всем.
 *
 * ЧТО МОЖЕТ ВЛАДЕЛЕЦ (и чего не может):
 *   может  — менять комиссию, но не выше 2%; это ограничение в коде,
 *            обойти его нельзя даже владельцу
 *   может  — менять адрес казны и список принимаемых валют
 *   может  — забрать из бонусного пула только то, что никому не обещано
 *   НЕ может — тронуть выручку продавца
 *   НЕ может — забрать уже начисленные продавцам бонусы
 *   НЕ может — остановить или отменить платёж
 *
 * БОНУСЫ (та самая «добыча»):
 *   За каждый платёж продавцу начисляются TVR из конечного пула.
 *   Ставка падает вдвое каждый раз, когда израсходована очередная доля пула —
 *   как половинения у биткоина. Никто этим не управляет вручную.
 *   Начисленное выдаётся не сразу, а равномерно: за 90 дней после остановки
 *   начислений выбирается всё. Это защита от того, чтобы кто-то накопил
 *   и обрушил цену одной продажей.
 */

interface IMerchantVault {
    function init(address merchant, address hub) external;
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract TavarovPay {

    // ------------------------------------------------------------------
    // Настройки
    // ------------------------------------------------------------------

    /// Номер версии. По нему кошелёк понимает, умеет ли контракт возвраты:
    /// в первой версии этой переменной нет, и вызов просто не проходит.
    uint16 public constant VERSION = 2;

    /// Жёсткий предел комиссии — 2%. Записан в код, менять нельзя никому.
    uint16 public constant MAX_FEE_BPS = 200;

    /// Срок полной выдачи бонусов. Задаётся при развёртывании:
    /// на боевом контракте 90 дней, на тестах ставьте минуты, чтобы всё увидеть сразу.
    uint256 public immutable VESTING;

    /// Жёсткий предел доли покупателя — 90% награды за платёж.
    /// Оставшиеся 10% продавцу гарантированы кодом: обещание «продавец
    /// добывает за оборот» не должно зависеть от настроек владельца.
    uint16 public constant MAX_BUYER_SHARE_BPS = 9000;

    address public owner;
    address public treasury;      // куда падает комиссия
    uint16  public feeBps = 50;   // 50 = 0,5%

    /**
     * Как делится награда за платёж между покупателем и продавцом.
     * 6000 = покупателю 60%, продавцу 40%. Ноль — всё продавцу.
     *
     * Важно: это доля ОДНОЙ И ТОЙ ЖЕ награды, а не добавка сверху.
     * Сколько бы вы ни сдвинули ползунок, из пула за платёж уходит одно
     * и то же количество TVR. Поэтому баланс между сторонами можно менять
     * свободно, не пересчитывая, на сколько лет хватит пула.
     */
    uint16  public buyerShareBps = 6000;

    IERC20  public immutable rewardToken;   // TVR

    /// Валюты, которыми разрешено платить (USDT, USDC), и ставка бонусов по каждой.
    /// rewardPerUnit — сколько TVR (в минимальных долях) даётся за одну
    /// минимальную долю этой валюты. Разные валюты имеют разное число знаков,
    /// поэтому ставка задаётся отдельно для каждой.
    mapping(address => bool)    public acceptedToken;
    mapping(address => uint256) public rewardPerUnit;

    // ------------------------------------------------------------------
    // Бонусный пул и половинения
    // ------------------------------------------------------------------

    uint256 public rewardPoolTotal;   // сколько TVR внесено в пул всего
    uint256 public rewardDistributed; // сколько уже начислено продавцам
    uint256 public rewardOwed;        // сколько начислено, но ещё не забрано
    uint256 public halvingStep;       // после каждых стольких начисленных TVR ставка падает вдвое

    /// Состояние бонусов продавца.
    struct Bonus {
        uint128 pending;    // начислено, но ещё не созрело
        uint128 claimable;  // созрело, можно забирать
        uint64  lastTouch;  // когда в последний раз пересчитывали
    }
    mapping(address => Bonus) public bonusOf;

    // ------------------------------------------------------------------
    // События
    // ------------------------------------------------------------------

    /**
     * Запись об одной оплате. Нужна ровно для возврата: чтобы вернуть
     * деньги и отменить бонусы, надо знать кому, сколько и сколько было
     * начислено. Пересчитать это потом нельзя — ставка бонусов падает со
     * временем, и задним числом она уже другая.
     *
     * Уложено в четыре ячейки: адрес занимает 20 байт, суммы — по 12,
     * и вместе они ровно помещаются в 32. Каждая лишняя ячейка — это
     * лишний газ с каждой покупки, а покупок будут миллионы.
     */
    struct Sale {
        address merchant;        // кому платили
        uint96  amount;          // сколько заплатил покупатель, до комиссии
        address buyer;           // кто платил
        uint96  refunded;        // сколько уже вернули
        address token;           // чем платили
        uint128 buyerReward;     // начислено покупателю
        uint128 merchantReward;  // начислено продавцу
    }

    /// Номер счёта -> что это была за покупка.
    mapping(bytes32 => Sale) public saleOf;

    event Refunded(
        address indexed merchant,
        address indexed buyer,
        address indexed token,
        uint256 amount,
        uint256 bonusCancelled,
        bytes32 invoice
    );

    event Paid(
        address indexed merchant,
        address indexed payer,
        address indexed token,
        uint256 amountToMerchant,
        uint256 fee,
        uint256 reward,
        bytes32 invoice
    );
    event Cashback(address indexed buyer, address indexed token, uint256 amount);
    event BuyerShareChanged(uint16 buyerShareBps);
    event BonusClaimed(address indexed merchant, uint256 amount);
    event RewardPoolFunded(uint256 amount);
    event FeeChanged(uint16 feeBps);
    event TreasuryChanged(address treasury);
    event TokenConfigured(address token, bool accepted, uint256 rewardPerUnit);
    event OwnerChanged(address newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Pay: not owner");
        _;
    }

    /// Адрес образца приёмника — с него снимаются дешёвые копии для продавцов.
    address public immutable vaultImplementation;

    /// Приёмники, созданные этим контрактом. Только они вправе начислять бонусы.
    mapping(address => bool)    public isVault;
    mapping(address => address) public vaultOf;   // продавец -> его приёмник

    event VaultCreated(address indexed merchant, address vault);

    constructor(
        address rewardToken_,
        address treasury_,
        uint256 halvingStep_,
        uint256 vestingSeconds_,
        address vaultImplementation_
    ) {
        require(rewardToken_ != address(0) && treasury_ != address(0), "Pay: zero address");
        require(vaultImplementation_ != address(0), "Pay: zero implementation");
        require(halvingStep_ > 0, "Pay: halving step must be positive");
        require(vestingSeconds_ > 0 && vestingSeconds_ <= 365 days, "Pay: bad vesting");
        owner = msg.sender;
        treasury = treasury_;
        rewardToken = IERC20(rewardToken_);
        halvingStep = halvingStep_;
        VESTING = vestingSeconds_;
        vaultImplementation = vaultImplementation_;
    }

    // ------------------------------------------------------------------
    // Приёмники продавцов
    // ------------------------------------------------------------------

    /**
     * Создать продавцу его личный адрес для приёма оплаты.
     * На этот адрес можно платить простым переводом из любого кошелька —
     * Trust Wallet, биржа, что угодно. Делит и начисляет бонусы приёмник сам.
     *
     * Копия делается по приёму EIP-1167: разворачивается не весь контракт,
     * а крошечная ссылка на общий образец. Стоит копейки.
     */
    function createVault(address merchant) external returns (address vault) {
        require(merchant != address(0), "Pay: merchant is zero");
        require(vaultOf[merchant] == address(0), "Pay: vault already exists");

        bytes20 target = bytes20(vaultImplementation);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), target)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            vault := create(0, clone, 0x37)
        }
        require(vault != address(0), "Pay: clone failed");

        IMerchantVault(vault).init(merchant, address(this));
        isVault[vault] = true;
        vaultOf[merchant] = vault;
        emit VaultCreated(merchant, vault);
    }

    /// Сколько бонусов получат обе стороны с такой оплаты прямо сейчас.
    /// Нужно приложению, чтобы показать это покупателю до подтверждения.
    function previewRewards(address token, uint256 amount)
        external view returns (uint256 merchantReward, uint256 buyerReward)
    {
        uint256 total = rewardFor(token, amount);
        buyerReward = (total * buyerShareBps) / 10000;
        merchantReward = total - buyerReward;
    }

    /// Сколько взять комиссии с такой суммы. Нужно приёмнику.
    function splitOf(uint256 amount) external view returns (uint256 fee, uint256 toMerchant) {
        fee = (amount * feeBps) / 10000;
        toMerchant = amount - fee;
    }

    /// Начислить бонусы. Зовёт только приёмник, созданный этим контрактом.
    function accrueFromVault(address merchant, address token, uint256 amount) external returns (uint256) {
        require(isVault[msg.sender], "Pay: not a vault");
        require(acceptedToken[token], "Pay: token not accepted");
        return _accrueBonus(merchant, token, amount);
    }

    // ------------------------------------------------------------------
    // Оплата — то, ради чего всё это
    // ------------------------------------------------------------------

    /**
     * Покупатель вызывает это из приложения, предварительно разрешив
     * контракту списать нужную сумму (обычный approve у токена).
     *
     * @param merchant кому платим
     * @param token    чем платим (USDT / USDC)
     * @param amount   сколько, в минимальных долях валюты
     * @param invoice  номер счёта из кассы — чтобы приложение сопоставило оплату
     */
    function pay(address merchant, address token, uint256 amount, bytes32 invoice) external {
        require(merchant != address(0), "Pay: merchant is zero");
        require(merchant != msg.sender, "Pay: cannot pay yourself");
        require(acceptedToken[token], "Pay: token not accepted");
        require(amount > 0, "Pay: amount is zero");

        uint256 fee = (amount * feeBps) / 10000;
        uint256 toMerchant = amount - fee;

        // Деньги идут напрямую: покупатель -> продавец и покупатель -> казна.
        // В контракте они не оседают даже на мгновение.
        _pull(token, msg.sender, merchant, toMerchant);
        if (fee > 0) _pull(token, msg.sender, treasury, fee);

        // Награда за платёж делится между покупателем и продавцом.
        uint256 total     = rewardFor(token, amount);
        uint256 buyerPart = (total * buyerShareBps) / 10000;

        uint256 cashback = _credit(msg.sender, buyerPart);
        if (cashback > 0) emit Cashback(msg.sender, token, cashback);
        uint256 reward = _credit(merchant, total - buyerPart);

        /* Записываем покупку под её номером счёта — без этого возврат
           невозможен. Номер занимается один раз: заплатить дважды по
           одному счёту нельзя, иначе магазин отдал бы два товара за
           один заказ, а вернуть смог бы только один платёж. */
        require(saleOf[invoice].merchant == address(0), "Pay: invoice already used");
        require(amount <= type(uint96).max, "Pay: amount too large");
        saleOf[invoice] = Sale({
            merchant: merchant,
            amount: uint96(amount),
            buyer: msg.sender,
            refunded: 0,
            token: token,
            buyerReward: uint128(cashback),
            merchantReward: uint128(reward)
        });

        emit Paid(merchant, msg.sender, token, toMerchant, fee, reward, invoice);
    }

    // ------------------------------------------------------------------
    // Возврат
    // ------------------------------------------------------------------

    /**
     * Вернуть покупателю деньги за покупку. Зовёт продавец, за свою покупку.
     *
     * СКОЛЬКО ВОЗВРАЩАТЬ. Считаем от того, что заплатил покупатель, а не от
     * того, что дошло до продавца. Разница — комиссия, она ушла в казну в
     * момент оплаты, и вернуть её оттуда контракт не может. Значит при
     * полном возврате продавец отдаёт на один процент больше, чем получил.
     * Это честно по отношению к покупателю: он платил столько, столько и
     * получает назад. У карт, к слову, ровно так же.
     *
     * Возврат можно делать частями — например, вернуть за один товар из
     * трёх. Больше, чем было заплачено, вернуть нельзя.
     *
     * БОНУСЫ. Отменяются соразмерно возвращённому: вернули половину —
     * снялась половина начисленного обеим сторонам. Отменённое уходит
     * обратно в пул, и его снова можно заработать. Уже забранное с
     * кошелька не снимается: это чужие деньги, и контракт до них не
     * дотягивается — как и должно быть.
     *
     * ЧЕГО ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ. Она не отменяет платёж и не «списывает»
     * его у продавца. Это обычный обратный перевод, просто записанный так,
     * чтобы его увидел магазин и учёл бонусный пул.
     */
    function refund(bytes32 invoice, uint256 amount) external {
        Sale storage sale = saleOf[invoice];
        require(sale.merchant != address(0), "Pay: unknown invoice");
        require(sale.merchant == msg.sender, "Pay: not your sale");
        require(amount > 0, "Pay: amount is zero");
        require(uint256(sale.refunded) + amount <= uint256(sale.amount), "Pay: more than was paid");

        address buyer = sale.buyer;
        address token = sale.token;
        uint256 paid  = sale.amount;

        /* Отмечаем возврат ДО перевода: перевод зовёт чужой контракт
           токена, а из него можно вернуться сюда же и попросить второй
           возврат по тому же счёту. Записав сначала, мы этого не даём. */
        sale.refunded = uint96(uint256(sale.refunded) + amount);

        uint256 cancelled =
            _debit(buyer,       (uint256(sale.buyerReward)    * amount) / paid) +
            _debit(sale.merchant,(uint256(sale.merchantReward) * amount) / paid);

        // Деньги идут напрямую: продавец -> покупатель. Здесь они не оседают.
        _pull(token, msg.sender, buyer, amount);

        emit Refunded(msg.sender, buyer, token, amount, cancelled, invoice);
    }

    /**
     * Снять начисленные бонусы. Сначала из несозревшего, потом из
     * созревшего: несозревшее — это ещё обещание, а созревшее человек мог
     * и не забрать просто потому, что не заходил в приложение.
     *
     * Снятое возвращается в пул: оно не выдано никому и должно снова
     * стать доступным для начисления, а не сгореть.
     */
    function _debit(address account, uint256 amount) internal returns (uint256 cancelled) {
        if (amount == 0) return 0;
        _settle(account);
        Bonus storage b = bonusOf[account];

        uint256 fromPending = amount > b.pending ? b.pending : amount;
        b.pending -= uint128(fromPending);
        cancelled = fromPending;

        uint256 rest = amount - fromPending;
        if (rest > 0) {
            uint256 fromClaimable = rest > b.claimable ? b.claimable : rest;
            b.claimable -= uint128(fromClaimable);
            cancelled += fromClaimable;
        }

        if (cancelled > 0) {
            rewardOwed        -= cancelled;
            rewardDistributed -= cancelled;
        }
    }

    // ------------------------------------------------------------------
    // Бонусы
    // ------------------------------------------------------------------

    /// Сколько бонусов даётся за такой платёж прямо сейчас, с учётом половинений.
    function rewardFor(address token, uint256 amount) public view returns (uint256) {
        uint256 rate = rewardPerUnit[token];
        if (rate == 0) return 0;

        uint256 halvings = rewardDistributed / halvingStep;
        if (halvings > 63) return 0;              // пул фактически исчерпан
        uint256 reward = (amount * rate) >> halvings;

        uint256 left = rewardPoolTotal - rewardDistributed;
        return reward > left ? left : reward;
    }

    /**
     * Начисление продавцу, когда покупатель неизвестен — то есть при обычном
     * переводе на приёмник из чужого кошелька.
     *
     * Продавец получает ровно свою долю, а доля покупателя просто не
     * выпускается и остаётся в пуле. Сделано намеренно: иначе продавцу было
     * бы выгоднее, чтобы покупатель НЕ платил через приложение, и мы своими
     * руками сломали бы то, ради чего всё затевалось.
     */
    function _accrueBonus(address merchant, address token, uint256 amount) internal returns (uint256) {
        uint256 total = rewardFor(token, amount);
        return _credit(merchant, total - (total * buyerShareBps) / 10000);
    }

    /**
     * Записать кому-то бонус. Отдельно от расчёта, потому что начисляем
     * дважды: продавцу за оборот и покупателю за покупку. Больше, чем
     * осталось в пуле, не выдаётся никогда — здесь это и проверяется.
     */
    function _credit(address account, uint256 reward) internal returns (uint256) {
        if (reward == 0) return 0;
        uint256 left = rewardPoolTotal - rewardDistributed;
        if (reward > left) reward = left;
        if (reward == 0) return 0;

        _settle(account);
        Bonus storage b = bonusOf[account];
        b.pending += uint128(reward);

        rewardDistributed += reward;
        rewardOwed += reward;
        return reward;
    }

    /**
     * Пересчёт созревания. Из ещё не созревшего каждый день переходит
     * в доступное 1/90 часть. Если начисления прекратились, за 90 дней
     * выбирается всё.
     */
    function _settle(address merchant) internal {
        Bonus storage b = bonusOf[merchant];
        uint64 nowTs = uint64(block.timestamp);

        if (b.lastTouch == 0) { b.lastTouch = nowTs; return; }
        if (b.pending == 0)   { b.lastTouch = nowTs; return; }

        uint256 elapsed = nowTs - b.lastTouch;
        if (elapsed == 0) return;
        if (elapsed > VESTING) elapsed = VESTING;

        uint256 matured = (uint256(b.pending) * elapsed) / VESTING;
        b.pending   -= uint128(matured);
        b.claimable += uint128(matured);
        b.lastTouch  = nowTs;
    }

    /// Сколько продавец может забрать прямо сейчас (без изменения состояния).
    function claimableOf(address merchant) external view returns (uint256) {
        Bonus memory b = bonusOf[merchant];
        if (b.lastTouch == 0 || b.pending == 0) return b.claimable;
        uint256 elapsed = block.timestamp - b.lastTouch;
        if (elapsed > VESTING) elapsed = VESTING;
        return b.claimable + (uint256(b.pending) * elapsed) / VESTING;
    }

    /// Забрать созревшие бонусы.
    function claimBonus() external {
        _settle(msg.sender);
        Bonus storage b = bonusOf[msg.sender];
        uint256 amount = b.claimable;
        require(amount > 0, "Pay: nothing to claim");

        b.claimable = 0;
        rewardOwed -= amount;

        require(rewardToken.transfer(msg.sender, amount), "Pay: reward transfer failed");
        emit BonusClaimed(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Пополнение бонусного пула
    // ------------------------------------------------------------------

    /**
     * Учесть в пуле монеты, пришедшие сюда переводом — прежде всего эмиссию
     * токена, которая приходит сама, минуя fundRewardPool.
     *
     * Звать может кто угодно, решать здесь нечего: контракт просто сравнивает
     * свой настоящий баланс с тем, что уже посчитано, и разницу записывает
     * в пул. Владелец на это не влияет.
     */
    function syncRewardPool() external returns (uint256 added) {
        uint256 balance  = rewardToken.balanceOf(address(this));
        uint256 accounted = rewardPoolTotal - rewardDistributed + rewardOwed;
        if (balance <= accounted) return 0;
        added = balance - accounted;
        rewardPoolTotal += added;
        emit RewardPoolFunded(added);
    }

    /// Кто угодно может добавить TVR в пул. Обычно это делаете вы.
    function fundRewardPool(uint256 amount) external {
        require(amount > 0, "Pay: amount is zero");
        require(rewardToken.transferFrom(msg.sender, address(this), amount), "Pay: funding failed");
        rewardPoolTotal += amount;
        emit RewardPoolFunded(amount);
    }

    /**
     * Забрать из пула ЛИШНЕЕ — то, что ещё никому не начислено.
     * Обещанные продавцам бонусы вытащить нельзя: rewardOwed вычитается.
     */
    function withdrawUnallocated(uint256 amount) external onlyOwner {
        uint256 balance = rewardToken.balanceOf(address(this));
        require(balance >= rewardOwed, "Pay: accounting broken");
        require(amount <= balance - rewardOwed, "Pay: would touch owed bonuses");

        rewardPoolTotal -= amount > rewardPoolTotal ? rewardPoolTotal : amount;
        require(rewardToken.transfer(msg.sender, amount), "Pay: transfer failed");
    }

    // ------------------------------------------------------------------
    // Настройки владельца — с ограничениями
    // ------------------------------------------------------------------

    function setFee(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Pay: fee above hard limit");
        feeBps = newFeeBps;
        emit FeeChanged(newFeeBps);
    }

    function setBuyerShare(uint16 newShareBps) external onlyOwner {
        require(newShareBps <= MAX_BUYER_SHARE_BPS, "Pay: buyer share above hard limit");
        buyerShareBps = newShareBps;
        emit BuyerShareChanged(newShareBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Pay: zero address");
        treasury = newTreasury;
        emit TreasuryChanged(newTreasury);
    }

    function configureToken(address token, bool accepted, uint256 rewardPerUnit_) external onlyOwner {
        require(token != address(0), "Pay: zero address");
        acceptedToken[token] = accepted;
        rewardPerUnit[token] = rewardPerUnit_;
        emit TokenConfigured(token, accepted, rewardPerUnit_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Pay: zero address");
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    // ------------------------------------------------------------------
    // Перевод токенов с оглядкой на USDT
    // ------------------------------------------------------------------

    /**
     * USDT — исторически кривой токен: его transferFrom не возвращает
     * значение, хотя стандарт требует. Обычный вызов на нём падает.
     * Поэтому зовём низкоуровнево и считаем успехом либо пустой ответ,
     * либо true.
     */
    function _pull(address token, address from, address to, uint256 value) internal {
        if (value == 0) return;
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "Pay: transfer failed");
    }
}
