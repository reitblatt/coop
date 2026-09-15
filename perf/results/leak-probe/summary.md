# Coop resource measurement — leak-probe

Host: 8 cpu / 14.9 GiB · node v24.20.0 · 2026-09-15T17:50:16.582Z

## Startup

| metric | value |
| --- | --- |
| bootToReadyMs | 2762 |

## Processes — graphql

Total RSS: mean 778.6 MiB, max 874.1 MiB, trend -11.78 MiB/min over 20.2s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 591.8 | 655 | 552 | 11 | 55 | 19.1 | 528.01 |
| worker | 1 | 186.8 | 272.3 | 146.9 | 11 | 27 | 0.2 | -539.78 |

## Processes — idle

Total RSS: mean 599.7 MiB, max 599.8 MiB, trend 0.35 MiB/min over 60.7s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 327.4 | 327.5 | 291.9 | 11 | 26 | 0.2 | 0.29 |
| worker | 1 | 272.3 | 272.3 | 236.7 | 11 | 27 | 0.2 | 0.06 |

## Processes — ingest

Total RSS: mean 971.2 MiB, max 1099.4 MiB, trend 893.14 MiB/min over 20.5s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 817.8 | 927 | 779.5 | 11 | 69 | 27.4 | 756.81 |
| worker | 1 | 153.4 | 172.8 | 115.3 | 11 | 39 | 2.2 | 136.33 |

## Processes — ready

Total RSS: mean 678.5 MiB, max 680 MiB, trend 9.95 MiB/min over 20.2s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 406.3 | 407.7 | 366.9 | 11 | 51 | 0.3 | 9.94 |
| worker | 1 | 272.3 | 272.3 | 232.9 | 11 | 27 | 0.1 | 0.01 |

## Processes — settle

Total RSS: mean 1499.5 MiB, max 1672.2 MiB, trend -16.24 MiB/min over 150.6s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 1396.3 | 1573.9 | 1372.2 | 11 | 45 | 18.9 | -3.09 |
| worker | 1 | 103.2 | 181.1 | 79.1 | 11 | 29 | 4.3 | -13.16 |

## Processes — soak

Total RSS: mean 1491.9 MiB, max 1940 MiB, trend -217.85 MiB/min over 90s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-server | 1 | 1320 | 1792.7 | 1291 | 11 | 70 | 82.5 | -273.62 |
| worker | 1 | 171.9 | 213.5 | 143.2 | 11 | 39 | 4.6 | 55.77 |

## Containers — graphql

Total: 3049.7 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 1342.7 | 1382.4 | 7.8 | 911 |
| coop-hma-1 | 39.8 | 40.1 | 0.2 | 22 |
| coop-jaeger-1 | 12.5 | 12.5 | 0 | 13 |
| coop-otel-collector-1 | 117.1 | 117.3 | 0 | 13 |
| coop-postgres-1 | 39 | 40 | 42.7 | 14 |
| coop-redis-1 | 7.9 | 8.1 | 1.2 | 6 |
| coop-scylla-1 | 1490.7 | 1518.6 | 10.3 | 53 |

## Containers — idle

Total: 3315.6 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 1591.5 | 1710.1 | 13.8 | 911 |
| coop-hma-1 | 38.7 | 40 | 0.2 | 22 |
| coop-jaeger-1 | 12.6 | 13 | 0 | 13 |
| coop-otel-collector-1 | 112.8 | 113.4 | 0 | 13 |
| coop-postgres-1 | 27.7 | 28.3 | 1.4 | 11 |
| coop-redis-1 | 7.9 | 8.2 | 1.3 | 6 |
| coop-scylla-1 | 1524.4 | 1560.6 | 8.9 | 55 |

## Containers — ingest

Total: 3564.8 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 1959.3 | 2283.5 | 266.4 | 911 |
| coop-hma-1 | 36.9 | 39.9 | 0.2 | 22 |
| coop-jaeger-1 | 13 | 13.2 | 0 | 13 |
| coop-otel-collector-1 | 47.9 | 117.2 | 0.1 | 13 |
| coop-postgres-1 | 58.1 | 69.3 | 14.1 | 17 |
| coop-redis-1 | 15.6 | 29.7 | 2.7 | 6 |
| coop-scylla-1 | 1434 | 1500.2 | 39.8 | 53 |

## Containers — ready

Total: 3078.7 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 1354.3 | 1396.7 | 4 | 911 |
| coop-hma-1 | 39.3 | 40 | 0.2 | 22 |
| coop-jaeger-1 | 12.6 | 12.7 | 0 | 13 |
| coop-otel-collector-1 | 117 | 117.3 | 0 | 13 |
| coop-postgres-1 | 28.5 | 28.7 | 2.5 | 10 |
| coop-redis-1 | 8 | 8.1 | 0.6 | 6 |
| coop-scylla-1 | 1519 | 1519.6 | 20.5 | 53 |

## Containers — settle

Total: 3613.9 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2237.6 | 2428.9 | 80.2 | 915 |
| coop-hma-1 | 39.1 | 41.3 | 0.2 | 22 |
| coop-jaeger-1 | 11.9 | 26.1 | 0.5 | 13 |
| coop-otel-collector-1 | 27 | 98.1 | 0.9 | 13 |
| coop-postgres-1 | 29.8 | 50.6 | 2.3 | 18 |
| coop-redis-1 | 12.4 | 26.5 | 1.6 | 8 |
| coop-scylla-1 | 1256.1 | 1630.2 | 7.8 | 58 |

## Containers — soak

Total: 3512.6 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2230.4 | 2518 | 251.4 | 917 |
| coop-hma-1 | 30.3 | 41 | 0.3 | 22 |
| coop-jaeger-1 | 9.9 | 13.7 | 0 | 13 |
| coop-otel-collector-1 | 18.9 | 36.2 | 2.3 | 13 |
| coop-postgres-1 | 31.9 | 57.7 | 21.8 | 17 |
| coop-redis-1 | 10.8 | 26.1 | 3.1 | 9 |
| coop-scylla-1 | 1180.4 | 1354.8 | 41.5 | 54 |

## In-process heap — probe-server

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 45.7 | 1218.9 | 1777.5 | |
| heapUsed MiB | 4.8 | 71.8 | 953.5 | 31.72 |
| external MiB | 2 | 4.5 | 63.4 | |
| handles | | | 48 | |

## In-process heap — probe-worker

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 47.5 | 98.5 | 271.5 | |
| heapUsed MiB | 4.8 | 50.8 | 115.7 | 1.71 |
| external MiB | 2 | 4.5 | 7.1 | |
| handles | | | 17 | |

## Load phases

| phase | scenario | conc | rps | p50 ms | p90 ms | p99 ms | errors | statuses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| graphql | graphql-me | 25 | 941.5 | 24.3 | 32.61 | 61.64 | 0 | {"200":18852} |
| ingest | items-async | 25 | 230.2 | 52.39 | 201.65 | 662.27 | 0 | {"202":5095} |
| ready | ready | 25 | 24.9 | 1001.91 | 1006.62 | 1013.95 | 0 | {"200":500} |
| soak | mixed | 25 | 198.4 | 86 | 195.17 | 662.33 | 0 | {"200":12663,"202":5397} |

## Disk footprint

| item | MiB |
| --- | --- |
| rootNodeModulesMib | 120 |
| serverNodeModulesMib | 389 |
| clientNodeModulesMib | 700 |
| dbNodeModulesMib | 93 |
| migratorNodeModulesMib | 86 |
| nodeModulesTotalMib | 1388 |
| serverTranspiledMib | 9 |
| clientBuildMib | 0 |
| checkoutMib | 2497 |
| serverPackages | 1330 |
| clientPackages | 878 |
| rootPackages | 326 |
| imageServerMib | 590 |
| imageServerBaseMib | 876 |
| imageClientMib | 1091 |

