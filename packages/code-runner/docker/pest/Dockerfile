FROM php:8.3-cli-alpine

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /runner

RUN composer init --name=omnitech/pest-runner --no-interaction \
    && composer config --no-plugins allow-plugins.pestphp/pest-plugin true \
    && composer require --dev pestphp/pest:"^3.8" --no-interaction --no-progress

COPY phpunit.xml /runner/phpunit.xml

WORKDIR /workspace
