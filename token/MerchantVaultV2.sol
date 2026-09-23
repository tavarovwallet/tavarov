// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MerchantVaultV2 — личный адрес продавца для приёма оплаты (для TavarovPay v3).
 *
 * Отличие от первой версии одно: если продавца кто-то привёл, пятая часть
 * комиссии уходит пригласившему, остальное — в казну. Сколько и кому,
 * решает контракт оплаты по записи, которую продавец сделал сам.
 *
 * Продавец показывает покупателю QR с адресом своего приёмника. Покупатель
 * платит обычным переводом из любого кошелька — Trust Wallet, биржа, что
 * угодно. Приёмнику всё равно, откуда пришло.
 *
 * Дальше любой может нажать «разделить» (это делает наше приложение, когда
 * продавец открывает кассу): деньги уходят продавцу, комиссия — в казну,
 * продавцу начисляются бонусы TVR.
 *
 * ЧЕГО ЗДЕСЬ НЕТ, И ЭТО ГЛАВНОЕ:
 *   нет владельца, нет обновления, нет функции «забрать себе».
 *   Деньги из приёмника могут уйти ровно по трём адресам: продавцу, в казну
 *   и пригласившему продавца — только в пределах комиссии.
 *   Ни автор контракта, ни кто-либо ещё не может отправить их куда-то ещё,
 *   заморозить или задержать. Это не обещание — это единственное, что
 *   написано в коде.
 *
 * Разворачивается не целиком, а дешёвой копией (EIP-1167) — поэтому у каждого
 * продавца свой приёмник, и это почти ничего не стоит.
 */

interface IPayHubV3 {
    function splitOf(uint256 amount) external view returns (uint256 fee, uint256 toMerchant);
    function treasury() external view returns (address);
    function accrueFromVault(address merchant, address token, uint256 amount) external returns (uint256);
    function acceptedToken(address token) external view returns (bool);
    function routeVaultFee(address merchant, address token, uint256 fee) external returns (address referrer, uint256 share);
}

contract MerchantVaultV2 {
    address public merchant;
    IPayHubV3 public hub;

    event Settled(address indexed token, uint256 toMerchant, uint256 fee, uint256 reward);

    /// Вызывается один раз при создании копии. Повторно — уже нельзя.
    function init(address merchant_, address hub_) external {
        require(merchant == address(0), "Vault: already initialised");
        require(merchant_ != address(0) && hub_ != address(0), "Vault: zero address");
        merchant = merchant_;
        hub = IPayHubV3(hub_);
    }

    /// Сколько сейчас лежит и ждёт разделения.
    function pending(address token) external view returns (uint256) {
        return IERC20MinimalV2(token).balanceOf(address(this));
    }

    /**
     * Разделить всё, что пришло. Звать может кто угодно — приложение продавца,
     * сам продавец, ваш служебный скрипт. Кто зовёт, тот платит комиссию сети,
     * но деньги всё равно идут только продавцу, в казну и пригласившему.
     */
    function settle(address token) external returns (uint256 toMerchant, uint256 fee) {
        require(merchant != address(0), "Vault: not initialised");

        uint256 balance = IERC20MinimalV2(token).balanceOf(address(this));
        require(balance > 0, "Vault: nothing to settle");

        (fee, toMerchant) = hub.splitOf(balance);

        // Сначала записали, потом отправили — порядок важен против повторного входа.
        if (fee > 0) {
            (address referrer, uint256 share) = hub.routeVaultFee(merchant, token, fee);
            require(share <= fee, "Vault: bad split");
            if (share > 0) _send(token, referrer, share);
            _send(token, hub.treasury(), fee - share);
        }
        _send(token, merchant, toMerchant);

        uint256 reward = 0;
        // Бонусы даются только за валюты, которые вы разрешили. За случайно
        // присланный посторонний токен приёмник просто перешлёт его продавцу.
        if (hub.acceptedToken(token)) {
            reward = hub.accrueFromVault(merchant, token, balance);
        }

        emit Settled(token, toMerchant, fee, reward);
    }

    /**
     * USDT не возвращает значение из transfer, хотя стандарт требует.
     * Поэтому зовём низкоуровнево и считаем успехом пустой ответ или true.
     */
    function _send(address token, address to, uint256 value) internal {
        if (value == 0) return;
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20MinimalV2.transfer.selector, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "Vault: transfer failed");
    }
}

interface IERC20MinimalV2 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
