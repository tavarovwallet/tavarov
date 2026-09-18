// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * FeeSplitter — казна, которая сама делит комиссию на выкуп токена и развитие.
 *
 * Зачем отдельный контракт, а не просто кошелёк: чтобы держатели TVR могли
 * своими глазами убедиться, что вы правда отправляете деньги на выкуп, а не
 * просто говорите об этом. Доли записаны в блокчейне, история переводов
 * публична и вечна.
 *
 * Комиссия падает сюда автоматически при каждой оплате. Дальше кто угодно
 * зовёт release — и накопленное расходится по долям.
 *
 * Владелец может менять доли, но НЕ может забрать деньги себе: единственный
 * путь наружу — по заданным адресам, по заданным долям.
 */

interface IERC20Basic {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract FeeSplitter {
    address public owner;

    address public buybackWallet;   // отсюда выкупаете TVR на бирже и сжигаете
    address public devWallet;       // разработка и содержание
    uint16  public buybackBps;      // доля выкупа, 6000 = 60%

    event Released(address indexed token, uint256 toBuyback, uint256 toDev);
    event SharesChanged(uint16 buybackBps);
    event WalletsChanged(address buybackWallet, address devWallet);
    event OwnerChanged(address newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Split: not owner");
        _;
    }

    constructor(address buybackWallet_, address devWallet_, uint16 buybackBps_) {
        require(buybackWallet_ != address(0) && devWallet_ != address(0), "Split: zero address");
        require(buybackBps_ <= 10000, "Split: share above 100%");
        owner = msg.sender;
        buybackWallet = buybackWallet_;
        devWallet = devWallet_;
        buybackBps = buybackBps_;
    }

    /// Разослать накопленное по долям. Звать может кто угодно.
    function release(address token) external returns (uint256 toBuyback, uint256 toDev) {
        uint256 balance = IERC20Basic(token).balanceOf(address(this));
        require(balance > 0, "Split: nothing to release");

        toBuyback = (balance * buybackBps) / 10000;
        toDev = balance - toBuyback;

        _send(token, buybackWallet, toBuyback);
        _send(token, devWallet, toDev);

        emit Released(token, toBuyback, toDev);
    }

    function setShares(uint16 newBuybackBps) external onlyOwner {
        require(newBuybackBps <= 10000, "Split: share above 100%");
        buybackBps = newBuybackBps;
        emit SharesChanged(newBuybackBps);
    }

    function setWallets(address buybackWallet_, address devWallet_) external onlyOwner {
        require(buybackWallet_ != address(0) && devWallet_ != address(0), "Split: zero address");
        buybackWallet = buybackWallet_;
        devWallet = devWallet_;
        emit WalletsChanged(buybackWallet_, devWallet_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Split: zero address");
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    function _send(address token, address to, uint256 value) internal {
        if (value == 0) return;
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Basic.transfer.selector, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "Split: transfer failed");
    }
}
